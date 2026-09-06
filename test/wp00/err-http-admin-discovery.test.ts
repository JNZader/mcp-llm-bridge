import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { safeError } from '../../src/core/safe-error.js';
import type { FreeModelRouter } from '../../src/free-models/router.js';
import type { SlimLocalLLMStatus } from '../../src/local-llm/status.js';
import type { DiscoveryResult } from '../../src/model-discovery/types.js';
import {
  registerAdminDiscoveryRoutes, type AdminDiscoveryServices,
} from '../../src/server/routes/admin/discovery.js';

const CANARY = 'private-discovery-canary';
const INTERNAL = safeError('INTERNAL_ERROR').message;
const DISCOVER = '/v1/admin/discover';
const CATALOG = '/v1/admin/catalog/refresh';

function data() {
  const model = { id: 'fixture-model', name: 'Fixture', loaded: true };
  const status: SlimLocalLLMStatus = {
    enabled: true, ready: true, readyReason: 'Local model ready',
    checkedAt: '2026-01-01T00:00:00Z', source: 'probe', cacheHit: false,
    backendCount: 2, connectedBackendCount: 1, disconnectedBackendCount: 0,
    errorBackendCount: 1, modelCount: 1,
    backends: [
      { backend: 'ollama', status: 'connected', baseUrl: 'http://localhost:11434',
        modelCount: 1, models: [model] },
      { backend: 'lm-studio', status: 'error', baseUrl: 'http://localhost:1234',
        modelCount: 0, models: [], error: CANARY },
    ],
  };
  const result: DiscoveryResult = {
    models: [{ local: { ...model, backend: 'ollama' }, hfMetadata: null,
      resolvedHfId: null, capabilities: ['chat'], recommendedCostTier: 'free',
      recommendedTasks: ['chat'] }],
    backendsScanned: ['ollama', 'lm-studio'], enrichedCount: 0, unenrichedCount: 1,
    timestamp: '2026-01-01T00:00:00Z', errors: [CANARY, CANARY + '-snapshot'],
    partial: true, snapshotUsed: true,
  };
  return { status, result };
}

function fixture(overrides: Partial<AdminDiscoveryServices> = {}, configured = true) {
  const input = data();
  const services: AdminDiscoveryServices = {
    loadCatalog: () => ({ version: 'fixture-v1', generatedAt: '2026-01-01',
      source: 'fixture', providers: [] }),
    importCatalog: () => [],
    getSlimLocalLLMStatus: async () => input.status,
    discoverModels: async () => input.result,
    ...overrides,
  };
  let imports = 0;
  const router = {
    getHealthChecker: () => undefined,
    getRegistry: () => ({ importModels() { imports++; return 2; } }),
  } as unknown as FreeModelRouter;
  const app = new Hono();
  let escaped = 0;
  app.onError((_error, c) => { escaped++; return c.json({ unexpected_fallback: true }, 500); });
  // Trusted test bindings: no detection, network, environment mutation or auth claim.
  registerAdminDiscoveryRoutes(app, { freeModelRouter: configured ? router : undefined }, services);
  return { ...input, app, imports: () => imports, escaped: () => escaped };
}

async function response(f: ReturnType<typeof fixture>, path: string) {
  return f.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, hfToken: 'fixture-token' }) });
}

describe('Admin discovery public error containment', () => {
  for (const stage of ['loadCatalog', 'getSlimLocalLLMStatus', 'discoverModels'] as const) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'revoked']) {
      it(`${stage}: ${kind} stays inside the canonical 500 boundary`, async () => {
        let accesses = 0;
        let value: unknown = new Error(CANARY);
        if (kind === 'string') value = CANARY;
        if (kind === 'getter') Object.defineProperty(value, 'message', {
          get() { accesses++; throw new Error(CANARY); },
        });
        if (kind === 'coercion') value = {
          get [Symbol.toPrimitive]() { accesses++; throw new Error(CANARY); },
        };
        if (kind === 'revoked') {
          const revocable = Proxy.revocable({}, {});
          revocable.revoke();
          value = revocable.proxy;
        }
        const f = fixture({ [stage]: () => { throw value; } });
        const res = await response(f, stage === 'loadCatalog' ? CATALOG : DISCOVER);
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: INTERNAL });
        assert.equal(accesses, 0);
        assert.equal(f.escaped(), 0);
      });
    }
  }

  it('keeps partial/snapshot metadata and every diagnostic slot without mutating input', async () => {
    const f = fixture();
    const before = JSON.stringify({ status: f.status, result: f.result });
    const res = await response(f, DISCOVER);
    assert.equal(res.status, 200);
    const expectedStatus = structuredClone(f.status);
    expectedStatus.backends[1]!.error = INTERNAL;
    assert.deepEqual(await res.json(), {
      ok: true, ...f.result, errors: [INTERNAL, INTERNAL], localLLMStatus: expectedStatus,
    });
    assert.equal(JSON.stringify({ status: f.status, result: f.result }), before);
    assert.equal(f.escaped(), 0);
  });

  it('does not access diagnostic array slots or a backend error getter', async () => {
    const f = fixture();
    let accesses = 0;
    const getter = () => { accesses++; throw new Error(CANARY); };
    Object.defineProperty(f.result.errors, '0', { get: getter, configurable: true });
    Object.defineProperty(f.status.backends[1], 'error', { get: getter, enumerable: true });
    const res = await response(f, DISCOVER);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.errors, [INTERNAL, INTERNAL]);
    assert.equal(body.localLLMStatus.backends[1].error, INTERNAL);
    assert.equal(JSON.stringify(body).includes(CANARY), false);
    assert.equal(accesses, 0);
    assert.equal(Object.getOwnPropertyDescriptor(f.result.errors, '0')?.get, getter);
    assert.equal(Object.getOwnPropertyDescriptor(f.status.backends[1], 'error')?.get, getter);
    assert.equal(f.escaped(), 0);
  });

  for (const absent of [false, true]) {
    it(`preserves clean diagnostics and optional absence: ${absent}`, async () => {
      const f = fixture();
      f.result.errors = [];
      if (absent) Reflect.deleteProperty(f.result, 'errors');
      const backend = f.status.backends[1];
      assert.ok(backend);
      Reflect.deleteProperty(backend, 'error');
      f.result.partial = false;
      f.result.snapshotUsed = false;
      const res = await response(f, DISCOVER);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, ...f.result, localLLMStatus: f.status });
      assert.equal('error' in backend, false);
    });
  }

  it('preserves catalog NOT_CONFIGURED 404 without invoking services', async () => {
    const f = fixture({ loadCatalog() { assert.fail('must not load'); } }, false);
    const res = await response(f, CATALOG);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), {
      error: 'Free model router not configured', code: 'NOT_CONFIGURED',
    });
    assert.equal(f.imports(), 0);
  });

  it('preserves catalog LOAD_FAILED 500 and performs no import', async () => {
    const f = fixture({ loadCatalog: () => null });
    const res = await response(f, CATALOG);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Failed to load catalog file', code: 'LOAD_FAILED' });
    assert.equal(f.imports(), 0);
  });

  it('preserves catalog success and executes the registry import once', async () => {
    const f = fixture();
    const res = await response(f, CATALOG);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      ok: true, imported: 2, catalogVersion: 'fixture-v1', providers: 0,
      message: 'Catalog refreshed: 2 models imported from 0 providers',
    });
    assert.equal(f.imports(), 1);
    assert.equal(f.escaped(), 0);
  });
});
