import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { safeError, toSafeHttpError } from '../../src/core/safe-error.js';
import { compressionStats } from '../../src/context-compression/output-compression.js';
import { registerObservabilityRoutes, type ObservabilityRouteDeps } from '../../src/server/routes/observability.js';

const CANARY = 'private-observability-canary';
const INTERNAL = toSafeHttpError(safeError('INTERNAL_ERROR')).body.error;
const INVALID = toSafeHttpError(safeError('INVALID_REQUEST')).body.error;
const logsPayload = { logs: [{ id: 'fixture', error: CANARY }], total: 1, limit: 100, offset: 0 };
const point = { timestamp: 100, requests: 2, successfulRequests: 1, failedRequests: 1,
  retriedRequests: 1, totalTokens: 10, cost: 0.25, avgLatency: 20, model: CANARY };
const flushStatus = { pending: 0, marker: CANARY };
const failureTargets = ['logs', 'live', 'reader', 'compression'] as const;
type FailureTarget = typeof failureTargets[number];

function fixture(target?: FailureTarget, fail?: () => never, disabled = false) {
  const calls: string[] = [];
  const queries: unknown[] = [];
  const invoke = (name: FailureTarget) => { calls.push(name); if (name === target && fail) fail(); };
  const deps = {
    router: {},
    ...(disabled ? {} : {
      requestLogger: { getLogs: async (query: unknown) => { invoke('logs'); queries.push(query); return logsPayload; } },
      analyticsAggregator: { query: () => { invoke('live'); return [point]; }, getFlushStatus: () => flushStatus },
      analyticsReader: { query: async () => { invoke('reader'); return []; } },
    }),
  } as unknown as ObservabilityRouteDeps;
  const app = new Hono();
  let escaped = 0;
  app.onError((_error, c) => { escaped++; return c.json({ unexpected_fallback: true }, 500); });
  registerObservabilityRoutes(app, deps);
  return { app, calls, queries, escaped: () => escaped };
}

async function assertBody(app: Hono, path: string, status: number, expected: unknown) {
  const response = await app.request(path);
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(body, expected);
  if (status >= 400) assert.equal(JSON.stringify(body).includes(CANARY), false);
}

describe('Observability failure projections', { concurrency: false, timeout: 10_000 }, () => {
  for (const target of failureTargets) {
    for (const kind of ['error', 'string', 'fake-issues', 'getter', 'coercion', 'revoked']) {
      it(`${target}: unknown ${kind} is a constant 500 without inspection`, async () => {
        let accesses = 0;
        let thrown: unknown = kind === 'string' ? CANARY : new Error(CANARY);
        if (kind === 'fake-issues') thrown = { issues: [{ message: CANARY, path: [CANARY] }] };
        if (kind === 'getter') thrown = {
          get issues() { accesses++; throw new Error(CANARY); },
          get message() { accesses++; throw new Error(CANARY); },
        };
        if (kind === 'coercion') thrown = { get [Symbol.toPrimitive]() { accesses++; throw new Error(CANARY); } };
        if (kind === 'revoked') {
          const proxy = Proxy.revocable({}, {});
          proxy.revoke();
          thrown = proxy.proxy;
        }
        const fail = () => { throw thrown; };
        const f = fixture(target, fail);
        const original = compressionStats.getSummary;
        try {
          if (target === 'compression') compressionStats.getSummary = fail;
          const path = target === 'logs' ? '/v1/logs'
            : target === 'compression' ? '/v1/compression/stats' : '/v1/analytics';
          await assertBody(f.app, path, 500, { error: INTERNAL });
          assert.equal(accesses, 0);
          assert.equal(f.escaped(), 0);
          assert.deepEqual(f.calls, target === 'reader' ? ['live', 'reader'] : target === 'compression' ? [] : [target]);
        } finally {
          compressionStats.getSummary = original;
        }
      });
    }
  }

  const invalidFields = [
    ['from', '0'], ['to', '0'], ['provider', CANARY.repeat(10)],
    ['model', CANARY.repeat(20)], ['correlationId', CANARY.repeat(20)],
    ['status', CANARY], ['minLatencyMs', '-1'], ['limit', '1001'], ['offset', '-1'],
  ] as const;
  for (const [field, value] of invalidFields) {
    it(`logs: reports only the allowlisted ${field} for real URL validation`, async () => {
      const f = fixture();
      await assertBody(f.app, `/v1/logs?${new URLSearchParams({ [field]: value })}`, 400,
        { error: INVALID, code: 'VALIDATION_ERROR', field });
      assert.deepEqual(f.calls, []);
    });
  }

  it('logs: preserves cross-field validation at to', async () => {
    const f = fixture();
    await assertBody(f.app, '/v1/logs?from=200&to=100', 400,
      { error: INVALID, code: 'VALIDATION_ERROR', field: 'to' });
    assert.deepEqual(f.calls, []);
  });

  it('logs: keeps optional defaults and strips unknown keys without stripping successful log data', async () => {
    const f = fixture();
    await assertBody(f.app, `/v1/logs?${CANARY}=ignored`, 200, logsPayload);
    assert.deepEqual(f.queries, [{ limit: 100, offset: 0 }]);
  });

  const invalidAnalytics = [
    // Exact compatibility fixture: design/contracts.md, "Exact legacy error fixtures", observability.
    ['dimension=week', 'Invalid dimension: week'],
    [`dimension=${CANARY}`, 'Invalid dimension'],
    ['from=invalid', 'Invalid from timestamp'], ['to=invalid', 'Invalid to timestamp'],
    ['from=200&to=100', 'from must be <= to'],
  ] as const;
  for (const [query, message] of invalidAnalytics) {
    it(`analytics: preserves finite INVALID_PARAMS projection for ${query}`, async () => {
      const f = fixture();
      await assertBody(f.app, `/v1/analytics?${query}`, 400, { error: 'INVALID_PARAMS', message });
      assert.deepEqual(f.calls, []);
    });
  }

  it('analytics: preserves successful data, source, flush status and summary', async () => {
    const f = fixture();
    await assertBody(f.app, '/v1/analytics', 200, {
      data: [point], dimension: 'hourly', source: 'live', flushStatus,
      summary: { totalRequests: 2, successfulRequests: 1, failedRequests: 1, retriedRequests: 1,
        totalTokens: 10, totalCost: 0.25, avgLatency: 20, errorRate: 0.5, retryRate: 0.5 },
    });
    assert.deepEqual(f.calls, ['live', 'reader']);
  });

  it('compression: preserves the real summary without mutating counters', async () => {
    const f = fixture();
    const expected = compressionStats.getSummary();
    await assertBody(f.app, '/v1/compression/stats', 200, expected);
    assert.deepEqual(compressionStats.getSummary(), expected);
  });

  for (const [path, error] of [['/v1/logs', 'Request logging not enabled'], ['/v1/analytics', 'Analytics not enabled']]) {
    it(`${path}: preserves unavailable-feature 503`, async () => {
      const f = fixture(undefined, undefined, true);
      await assertBody(f.app, path!, 503, { error });
      assert.deepEqual(f.calls, []);
    });
  }
});
