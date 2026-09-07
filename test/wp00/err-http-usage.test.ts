import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { CostTracker, type UsageQuery, type UsageRecord, type UsageSummary } from '../../src/core/cost-tracker.js';
import { registerUsageRoutes } from '../../src/server/routes/usage.js';

const CANARY = 'private-usage-error-canary';
const routes = [
  { path: '/v1/usage', operation: 'query' },
  { path: '/v1/usage/summary', operation: 'summary' },
] as const;
const records: UsageRecord[] = [{
  id: 7, provider: 'fixture-provider', keyName: 'default', model: 'fixture-model', project: 'fixture-project',
  userId: null, tokensIn: 2, tokensOut: 3, totalTokens: 5, costUsd: null, latencyMs: 11,
  success: true, errorMessage: null, createdAt: '2026-01-01T00:00:00Z',
}];
const summary: UsageSummary = {
  totalRequests: 1, totalTokensIn: 2, totalTokensOut: 3, totalTokens: 5, totalCostUsd: null,
  knownCostUsd: 0, unknownCostRequestCount: 1, hasUnknownCost: true, avgLatencyMs: 11, breakdown: [],
};

function appFor(costTracker?: CostTracker) {
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerUsageRoutes(app, { costTracker });
  return app;
}

async function fixture(run: (app: Hono, tracker: CostTracker) => Promise<void>) {
  const tracker = new CostTracker({ dbPath: ':memory:' });
  const query = tracker.query;
  const getSummary = tracker.summary;
  try {
    await run(appFor(tracker), tracker);
  } finally {
    tracker.query = query;
    tracker.summary = getSummary;
    tracker.destroy();
  }
}

describe('Usage HTTP failure containment', () => {
  for (const route of routes) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
      it(route.operation + ': contains ' + kind + ' without inspecting the thrown value', async () => {
        await fixture(async (app, tracker) => {
          let accesses = 0;
          const inspect = () => { accesses++; throw new Error(CANARY); };
          let value: unknown = new Error(CANARY);
          if (kind === 'string') value = CANARY;
          if (kind === 'getter') value = Object.defineProperty(new Error(), 'message', { get: inspect });
          if (kind === 'coercion') value = { [Symbol.toPrimitive]: inspect, toString: inspect };
          if (kind === 'proxy') value = new Proxy({}, { get: inspect, getPrototypeOf: inspect });
          if (kind === 'revoked') {
            const revocable = Proxy.revocable({}, {});
            revocable.revoke();
            value = revocable.proxy;
          }
          let calls = 0;
          tracker[route.operation] = () => { calls++; throw value; };
          const res = await app.request(route.path);
          assert.equal(res.status, 500);
          assert.equal(calls, 1);
          assert.equal(accesses, 0);
          assert.deepEqual(await res.json(), { error: 'An unexpected internal error occurred.' });
        });
      });
    }

    it(route.operation + ': remains unregistered without CostTracker', async () => {
      const res = await appFor().request(route.path);
      assert.equal(res.status, 404);
      assert.equal(await res.text(), '404 Not Found');
    });

    for (const project of ['query', 'header', 'absent', 'empty'] as const) {
      it(route.operation + ': preserves filters and project precedence for ' + project, async () => {
        await fixture(async (app, tracker) => {
          const calls: UsageQuery[] = [];
          tracker.query = (filters = {}) => { calls.push(filters); return records; };
          tracker.summary = (filters = {}) => { calls.push(filters); return summary; };
          const params = new URLSearchParams({
            provider: 'fixture-provider', model: 'fixture-model', from: '2026-01-01',
            to: '2026-02-01', groupBy: 'project', limit: '7suffix',
          });
          if (project === 'query') params.set('project', 'query-project');
          if (project === 'empty') params.set('project', '');
          const res = await app.request(route.path + '?' + params, {
            headers: project === 'absent' ? {} : { 'X-Project': 'header-project' },
          });
          assert.equal(res.status, 200);
          assert.deepEqual(await res.json(), route.operation === 'query'
            ? { records, count: 1 } : summary);
          assert.deepEqual(calls, [{
            provider: 'fixture-provider', model: 'fixture-model', from: '2026-01-01',
            to: '2026-02-01', groupBy: 'project',
            project: project === 'query' ? 'query-project' : project === 'empty' ? ''
              : project === 'header' ? 'header-project' : undefined,
            ...(route.operation === 'query' ? { limit: 7 } : {}),
          }]);
        });
      });
    }

    it(route.operation + ': preserves empty real tracker results with no filters', async () => {
      await fixture(async (app, tracker) => {
        const expected = route.operation === 'query'
          ? { records: tracker.query(), count: 0 } : tracker.summary();
        const res = await app.request(route.path);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), expected);
      });
    });
  }
});
