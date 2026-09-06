import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { CircuitState } from '../../src/circuit-breaker/index.js';
import { CostTracker } from '../../src/core/cost-tracker.js';
import { getCircuitBreakerV2 } from '../../src/core/router.js';
import { safeError } from '../../src/core/safe-error.js';
import { registerAdminOperationsRoutes } from '../../src/server/routes/admin/operations.js';

const CANARY = 'private-operations-canary';
const RESET = '/v1/admin/reset-circuit-breaker/';
const FLUSH = '/v1/admin/flush-usage';

function fixture(costTracker?: CostTracker) {
  const app = new Hono();
  let escaped = 0;
  app.onError((_error, c) => {
    escaped++;
    return c.json({ unexpected_fallback: true }, 500);
  });
  // Handler-only fixture: this does not establish authentication or CSRF behavior.
  registerAdminOperationsRoutes(app, { costTracker });
  return { app, escaped: () => escaped };
}

function privateFailure(kind: string) {
  let accesses = 0;
  let value: unknown = new Error(CANARY);
  if (kind === 'string') value = CANARY;
  if (kind === 'getter') {
    Object.defineProperty(value, 'message', {
      get() { accesses++; throw new Error(CANARY); },
    });
  }
  if (kind === 'coercion') {
    value = { get [Symbol.toPrimitive]() { accesses++; throw new Error(CANARY); } };
  }
  if (kind === 'proxy') {
    value = new Proxy({}, {
      get() { accesses++; throw new Error(CANARY); },
      getPrototypeOf() { accesses++; throw new Error(CANARY); },
    });
  }
  if (kind === 'revoked') {
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    value = revocable.proxy;
  }
  return { value, accesses: () => accesses };
}

async function assertPrivateError(response: Response, status: number, expected: unknown) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(body, expected);
  assert.equal(JSON.stringify(body).includes(CANARY), false);
}

describe('Admin operation error containment', { concurrency: false }, () => {
  for (const route of ['reset', 'flush'] as const) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
      it(`${route}: ${kind} remains a contained 500 without inspection`, async () => {
        const failure = privateFailure(kind);
        const tracker = new CostTracker({ dbPath: ':memory:', flushIntervalMs: 60_000 });
        const breaker = getCircuitBreakerV2();
        const target = route === 'reset' ? breaker : tracker;
        const method = route === 'reset' ? 'getAllStates' : 'flush';
        const descriptor = Object.getOwnPropertyDescriptor(target, method);
        let calls = 0;
        try {
          Object.defineProperty(target, method, {
            configurable: true,
            value() { calls++; throw failure.value; },
          });
          const f = fixture(tracker);
          const path = route === 'reset' ? RESET + 'failure-fixture' : FLUSH;
          await assertPrivateError(await f.app.request(path, { method: 'POST' }), 500,
            { error: safeError('INTERNAL_ERROR').message });
          assert.equal(calls, 1);
          assert.equal(failure.accesses(), 0);
          assert.equal(f.escaped(), 0);
        } finally {
          if (descriptor) Object.defineProperty(target, method, descriptor);
          else Reflect.deleteProperty(target, method);
          tracker.destroy();
        }
      });
    }
  }

  it('missing provider preserves NOT_FOUND 404 without reflecting its identifier', async () => {
    const f = fixture();
    await assertPrivateError(await f.app.request(RESET + CANARY, { method: 'POST' }), 404,
      { error: 'The requested resource was not found.', code: 'NOT_FOUND' });
    assert.equal(f.escaped(), 0);
  });

  it('missing tracker preserves the exact NOT_CONFIGURED 404', async () => {
    const f = fixture();
    await assertPrivateError(await f.app.request(FLUSH, { method: 'POST' }), 404,
      { error: 'Cost tracker not configured', code: 'NOT_CONFIGURED' });
    assert.equal(f.escaped(), 0);
  });

  it('resets real breaker state and preserves the successful response', async () => {
    const breaker = getCircuitBreakerV2();
    const provider = 'wp00-operations-reset';
    const model = 'fixture-model';
    try {
      for (let attempt = 0; attempt < breaker.getConfig().failureThreshold; attempt++) {
        breaker.recordFailure(provider, 'default', model);
      }
      assert.equal(breaker.getState(provider, 'default', model)?.state, CircuitState.OPEN);
      const f = fixture();
      const response = await f.app.request(RESET + provider, { method: 'POST' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true, provider, state: 'CLOSED',
        message: `Circuit breaker for ${provider} has been reset`,
      });
      assert.equal(breaker.getState(provider, 'default', model)?.state, CircuitState.CLOSED);
      assert.equal(f.escaped(), 0);
    } finally {
      breaker.reset(provider, 'default', model);
    }
  });

  it('flushes real buffered usage and preserves counters and persisted metadata', async () => {
    const tracker = new CostTracker({ dbPath: ':memory:', flushIntervalMs: 60_000 });
    try {
      tracker.record({
        provider: 'fixture-provider', model: 'fixture-model',
        tokensIn: 2, tokensOut: 3, latencyMs: 5, success: true,
      });
      assert.equal(tracker.bufferSize, 1);
      const f = fixture(tracker);
      const response = await f.app.request(FLUSH, { method: 'POST' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, flushed: 1, remainingBuffer: 0 });
      assert.equal(tracker.bufferSize, 0);
      const records = tracker.query({ provider: 'fixture-provider' });
      assert.equal(records.length, 1);
      assert.equal(records[0]?.model, 'fixture-model');
      assert.equal(records[0]?.totalTokens, 5);
      assert.equal(f.escaped(), 0);
    } finally {
      tracker.destroy();
    }
  });
});
