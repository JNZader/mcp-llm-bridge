import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { getCircuitBreakerV2 } from '../../src/core/router.js';
import { registerCircuitBreakerRoutes } from '../../src/server/routes/circuit-breaker.js';

const CONFIG = '/v1/circuit-breaker/config';
const STATS = '/v1/circuit-breaker/stats';
const SAFE = 'An unexpected internal error occurred.';
const CANARY = 'private-circuit-breaker-canary';

async function fixture(run: (app: Hono, breaker: ReturnType<typeof getCircuitBreakerV2>) => Promise<void>) {
  const breaker = getCircuitBreakerV2();
  const config = breaker.getConfig();
  const states = breaker.getAllStates();
  const methods = ['getConfig', 'updateConfig', 'getAllStates'] as const;
  const descriptors = methods.map((name) => Object.getOwnPropertyDescriptor(breaker, name));
  const originalUpdate = breaker.updateConfig;
  const enabled = process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'];
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerCircuitBreakerRoutes(app);
  try {
    process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] = 'true';
    await run(app, breaker);
  } finally {
    methods.forEach((name, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(breaker, name, descriptor);
      else Reflect.deleteProperty(breaker, name);
    });
    originalUpdate.call(breaker, config);
    if (enabled === undefined) delete process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'];
    else process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] = enabled;
    // Tests never create/reset singleton entries; preserve unrelated circuit state exactly.
    assert.deepEqual(breaker.getAllStates(), states);
  }
}

function put(app: Hono, body: unknown) {
  return app.request(CONFIG, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('Circuit breaker HTTP containment', { concurrency: false }, () => {
  for (const route of ['config', 'update', 'stats']) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
      it(route + ': contains ' + kind + ' without inspection', async () => {
        await fixture(async (app, breaker) => {
          let accesses = 0;
          const inspect = () => { accesses++; throw new Error(CANARY); };
          let value: unknown = new Error(CANARY);
          if (kind === 'string') value = CANARY;
          if (kind === 'getter') value = Object.defineProperty(new Error(), 'message', { get: inspect });
          if (kind === 'coercion') value = { [Symbol.toPrimitive]: inspect, toString: inspect };
          if (kind === 'proxy') value = new Proxy({}, { get: inspect, getPrototypeOf: inspect });
          if (kind === 'revoked') {
            const proxy = Proxy.revocable({}, {});
            proxy.revoke();
            value = proxy.proxy;
          }
          let calls = 0;
          const fail = () => { calls++; throw value; };
          if (route === 'config') breaker.getConfig = fail;
          if (route === 'update') breaker.updateConfig = fail;
          if (route === 'stats') breaker.getAllStates = fail;
          const res = route === 'update' ? await put(app, { failureThreshold: 3 })
            : await app.request(route === 'stats' ? STATS : CONFIG);
          assert.equal(res.status, 500);
          assert.deepEqual(await res.json(), { error: SAFE });
          assert.equal(accesses, 0);
          assert.equal(calls, 1);
        });
      });
    }
  }

  it('contains read-after-update failure without rolling back the successful update', async () => {
    await fixture(async (app, breaker) => {
      const read = breaker.getConfig;
      breaker.getConfig = () => { throw new Error(CANARY); };
      const res = await put(app, { failureThreshold: 9 });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: SAFE });
      assert.equal(read.call(breaker).failureThreshold, 9);
    });
  });

  for (const body of [{}, { failureThreshold: 0, backoffBaseMs: -1 }, { failureThreshold: '3', unknown: CANARY }]) {
    it('preserves fixed validation 400 without updating configuration: ' + JSON.stringify(body), async () => {
      await fixture(async (app, breaker) => {
        breaker.updateConfig = () => { assert.fail('Invalid input must not update config'); };
        const res = await put(app, body);
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'No valid config fields provided', code: 'VALIDATION_ERROR' });
      });
    });
  }

  it('preserves malformed JSON 500 with a constant error', async () => {
    await fixture(async (app) => {
      const res = await app.request(CONFIG, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' + CANARY });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: SAFE });
    });
  });

  it('preserves exact legacy mapping, positive-field selection and base-timeout precedence', async () => {
    await fixture(async (app, breaker) => {
      const res = await put(app, { failureThreshold: 7, backoffBaseMs: 1234, resetTimeoutMs: 4321,
        backoffMultiplier: 3, backoffMaxMs: 9999, halfOpenSuccessThreshold: 4, unknown: CANARY });
      const expected = { enabled: true, failureThreshold: 7, backoffBaseMs: 1234,
        resetTimeoutMs: 1234, backoffMultiplier: 3, backoffMaxMs: 9999, halfOpenSuccessThreshold: 4 };
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { updated: true, config: expected });
      assert.deepEqual(breaker.getConfig(), { failureThreshold: 7, baseCooldownMs: 1234,
        backoffMultiplier: 3, maxCooldownMs: 9999, halfOpenMaxRequests: 4 });
      const read = await app.request(CONFIG);
      assert.equal(read.status, 200);
      assert.deepEqual(await read.json(), expected);
      const fallback = await put(app, { resetTimeoutMs: 2222, failureThreshold: -9 });
      assert.equal(fallback.status, 200);
      assert.deepEqual(await fallback.json(), { updated: true, config: { ...expected, backoffBaseMs: 2222, resetTimeoutMs: 2222 } });
    });
  });

  it('preserves statistics metadata, cooldown capping, order and empty results', async () => {
    await fixture(async (app, breaker) => {
      breaker.updateConfig({ baseCooldownMs: 100, backoffMultiplier: 3, maxCooldownMs: 250 });
      breaker.getAllStates = () => [
        { key: 'fixture:default:model', entry: { state: 'OPEN', consecutiveFailures: 5, lastFailureTime: 1000, tripCount: 3, halfOpenRequests: 0 } },
        { key: 'other:default:model', entry: { state: 'CLOSED', consecutiveFailures: 0, lastFailureTime: 0, tripCount: 0, halfOpenRequests: 0 } },
      ];
      const res = await app.request(STATS);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { enabled: true, breakers: [
        { name: 'fixture:default:model', state: 'OPEN', failures: 5, successes: 0, lastFailureTime: 1000, currentCooldownMs: 250, consecutiveFailures: 5 },
        { name: 'other:default:model', state: 'CLOSED', failures: 0, successes: 0, lastFailureTime: 0, currentCooldownMs: 0, consecutiveFailures: 0 },
      ] });
      breaker.getAllStates = () => [];
      process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] = 'false';
      const empty = await app.request(STATS);
      assert.equal(empty.status, 200);
      assert.deepEqual(await empty.json(), { enabled: false, breakers: [] });
    });
  });
});
