import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { Router } from '../../src/core/router.js';
import { LatencyMeasurer } from '../../src/latency/index.js';
import { registerMetadataRoutes } from '../../src/server/routes/metadata.js';

const CANARY = 'private-metadata-error-canary';
const SAFE = 'An unexpected internal error occurred.';

async function fixture(run: (app: Hono, router: Router, latency: LatencyMeasurer) => Promise<void>, enabled = true) {
  const router = new Router();
  const latency = new LatencyMeasurer();
  const models = router.getAvailableModels;
  const providers = router.getProviderStatuses;
  const getAll = latency.getAll;
  const app = new Hono();
  app.onError(() => new Response('Unexpected framework fallback', { status: 599 }));
  registerMetadataRoutes(app, { router, latencyMeasurer: enabled ? latency : undefined });
  try {
    await run(app, router, latency);
  } finally {
    router.getAvailableModels = models;
    router.getProviderStatuses = providers;
    latency.getAll = getAll;
    latency.stopBackgroundTask();
  }
}

describe('Metadata GET failure containment', () => {
  for (const path of ['/v1/models', '/v1/providers', '/v1/latency']) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked']) {
      it(path + ': contains ' + kind + ' without inspecting the thrown value', async () => {
        await fixture(async (app, router, latency) => {
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
          router.getAvailableModels = async () => fail();
          router.getProviderStatuses = async () => fail();
          latency.getAll = fail;
          const res = await app.request(path);
          assert.equal(res.status, 500);
          assert.equal(calls, 1);
          assert.equal(accesses, 0);
          assert.deepEqual(await res.json(), path === '/v1/models'
            ? { error: { message: SAFE, type: 'server_error', param: null, code: null } }
            : { error: SAFE });
        });
      });
    }
  }

  it('preserves the exact model list projection', async () => {
    await fixture(async (app, router) => {
      router.getAvailableModels = async () => [
        { id: 'fixture-model', name: 'Fixture Model', provider: 'fixture-provider', maxTokens: 4096 },
      ];
      const res = await app.request('/v1/models');
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { object: 'list', data: [{
        id: 'fixture-model', object: 'model', created: 0, owned_by: 'llm-gateway',
        name: 'Fixture Model', provider: 'fixture-provider', max_tokens: 4096,
      }] });
    });
  });

  it('preserves available and unavailable provider metadata', async () => {
    await fixture(async (app, router) => {
      const providers = [
        { id: 'online', name: 'Online', type: 'api', available: true },
        { id: 'offline', name: 'Offline', type: 'cli', available: false },
      ];
      router.getProviderStatuses = async () => providers;
      const res = await app.request('/v1/providers');
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { providers });
    });
  });

  it('preserves empty lists without invoking registered providers or measurement', async () => {
    await fixture(async (app) => {
      for (const [path, expected] of [
        ['/v1/models', { object: 'list', data: [] }],
        ['/v1/providers', { providers: [] }],
      ] as const) {
        const res = await app.request(path);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), expected);
      }
      const res = await app.request('/v1/latency');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { providers: [], count: 0, timestamp: body.timestamp });
      assert.equal(Number.isFinite(Date.parse(body.timestamp)), true);
    });
  });

  it('preserves latency staleness and omits internal measurement URLs', async () => {
    await fixture(async (app, _router, latency) => {
      const now = Date.now();
      latency.getAll = () => [
        { provider: 'recent', url: CANARY, latencyMs: 12, measuredAt: now },
        { provider: 'old', url: CANARY, latencyMs: 34, measuredAt: now - 3 * 60 * 60 * 1000 },
      ];
      const res = await app.request('/v1/latency');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { providers: [
        { provider: 'recent', latencyMs: 12, measuredAt: now, stale: false },
        { provider: 'old', latencyMs: 34, measuredAt: now - 3 * 60 * 60 * 1000, stale: true },
      ], count: 2, timestamp: body.timestamp });
      assert.equal(Number.isFinite(Date.parse(body.timestamp)), true);
      assert.equal(JSON.stringify(body).includes(CANARY), false);
    });
  });

  it('preserves disabled latency 503 without invoking the dependency', async () => {
    await fixture(async (app, _router, latency) => {
      latency.getAll = () => { throw new Error('Must not be invoked'); };
      const res = await app.request('/v1/latency');
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: 'Latency measurement not enabled', code: 'NOT_ENABLED' });
    }, false);
  });
});
