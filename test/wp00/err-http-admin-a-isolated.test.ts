import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { getCircuitBreakerV2 } from '../../src/core/router.js';
import type { FreeModelRouter } from '../../src/free-models/router.js';
import type { SlimLocalLLMStatus } from '../../src/local-llm/status.js';
import {
  registerAdminApiKeyRoutes,
} from '../../src/server/routes/admin/api-keys.js';
import {
  registerAdminDiscoveryRoutes,
  type AdminDiscoveryServices,
} from '../../src/server/routes/admin/discovery.js';
import {
  registerAdminOperationsRoutes,
} from '../../src/server/routes/admin/operations.js';

const CANARY = 'private-admin-a-isolated-canary';
const INTERNAL = 'An unexpected internal error occurred.';
interface StructuralTracker {
  readonly bufferSize: number;
  flush(): void;
}

const slimStatus: SlimLocalLLMStatus = {
  enabled: false,
  ready: false,
  readyReason: 'Disabled for isolated test',
  checkedAt: '2026-01-01T00:00:00.000Z',
  source: 'probe',
  cacheHit: true,
  backendCount: 0,
  connectedBackendCount: 0,
  disconnectedBackendCount: 0,
  errorBackendCount: 0,
  modelCount: 0,
  backends: [],
};

function hostileFailure() {
  let accesses = 0;
  const failure = {};
  const inspect = () => { accesses++; throw new Error(CANARY); };
  Object.defineProperties(failure, {
    message: { get: inspect },
    stack: { get: inspect },
    toString: { get: inspect },
    [Symbol.toPrimitive]: { get: inspect },
  });
  return { failure, accesses: () => accesses };
}

function configuredRouter() {
  let unexpectedAccesses = 0;
  const guardError = new Error('Catalog loader must fail before router access');
  const target: Pick<FreeModelRouter, 'getHealthChecker' | 'getRegistry'> = {
    getHealthChecker(): never { throw guardError; },
    getRegistry(): never { throw guardError; },
  };
  // Test-only opaque sentinel: every property read is denied so this is not a class fake.
  const router = new Proxy(target, {
    get() { unexpectedAccesses++; throw guardError; },
  }) as FreeModelRouter;
  return { router, unexpectedAccesses: () => unexpectedAccesses };
}

function throwingDatabase(failure: unknown) {
  let calls = 0;
  let unexpectedAccesses = 0;
  const guardError = new Error('Unexpected database access');
  const target: Pick<Database.Database, 'prepare'> = {
    prepare() { throw guardError; },
  };
  const prepare = (): never => { calls++; throw failure; };
  // Test-only opaque sentinel: only prepare is available; every other read is denied.
  const db = new Proxy(target, {
    get(_target, property) {
      if (property === 'prepare') return prepare;
      unexpectedAccesses++;
      throw guardError;
    },
  }) as Database.Database;
  return { db, calls: () => calls, unexpectedAccesses: () => unexpectedAccesses };
}

function throwingServices(
  stage: 'loadCatalog' | 'getSlimLocalLLMStatus' | 'discoverModels',
  count: () => void,
  failure: unknown,
): AdminDiscoveryServices {
  const unexpected = (): never => { throw new Error('Unexpected discovery service'); };
  return {
    loadCatalog() {
      if (stage === 'loadCatalog') { count(); throw failure; }
      return unexpected();
    },
    importCatalog: unexpected,
    async getSlimLocalLLMStatus() {
      if (stage === 'getSlimLocalLLMStatus') { count(); throw failure; }
      return slimStatus;
    },
    async discoverModels() {
      if (stage === 'discoverModels') { count(); throw failure; }
      return unexpected();
    },
  };
}

function fixture(options: {
  db?: Database.Database;
  freeModelRouter?: FreeModelRouter;
  services?: AdminDiscoveryServices;
  costTracker?: StructuralTracker;
} = {}) {
  const app = new Hono();
  let onErrorCalls = 0;
  app.onError((_error, c) => {
    onErrorCalls++;
    return c.json({ unexpected_fallback: true }, 500);
  });
  registerAdminApiKeyRoutes(app, { db: options.db });
  registerAdminDiscoveryRoutes(app, { freeModelRouter: options.freeModelRouter }, options.services);
  registerAdminOperationsRoutes(app, { costTracker: options.costTracker });
  return { app, onErrorCalls: () => onErrorCalls };
}

async function assertInternal(response: Response) {
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { error: INTERNAL });
  assert.equal(JSON.stringify(body).includes(CANARY), false);
}

describe('Admin A isolated route containment', { concurrency: false }, () => {
  for (const route of [
    { method: 'POST', path: '/v1/admin/keys', body: { userId: 'fixture-user' } },
    { method: 'GET', path: '/v1/admin/keys' },
    { method: 'DELETE', path: '/v1/admin/keys/fixture-key' },
  ] as const) {
    it(`${route.method} ${route.path} contains a database prepare failure`, async () => {
      const hostile = hostileFailure();
      const db = throwingDatabase(hostile.failure);
      const f = fixture({ db: db.db });
      const response = await f.app.request(route.path, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        ...('body' in route ? { body: JSON.stringify(route.body) } : {}),
      });
      await assertInternal(response);
      assert.equal(db.calls(), 1);
      assert.equal(db.unexpectedAccesses(), 0);
      assert.equal(hostile.accesses(), 0);
      assert.equal(f.onErrorCalls(), 0);
    });
  }

  it('contains an injected catalog loader failure', async () => {
    const hostile = hostileFailure();
    let calls = 0;
    const router = configuredRouter();
    const f = fixture({
      freeModelRouter: router.router,
      services: throwingServices('loadCatalog', () => { calls++; }, hostile.failure),
    });
    await assertInternal(await f.app.request('/v1/admin/catalog/refresh', { method: 'POST' }));
    assert.equal(calls, 1);
    assert.equal(router.unexpectedAccesses(), 0);
    assert.equal(hostile.accesses(), 0);
    assert.equal(f.onErrorCalls(), 0);
  });

  for (const stage of ['getSlimLocalLLMStatus', 'discoverModels'] as const) {
    it(`contains an injected ${stage} failure`, async () => {
      const hostile = hostileFailure();
      let calls = 0;
      const f = fixture({
        services: throwingServices(stage, () => { calls++; }, hostile.failure),
      });
      await assertInternal(await f.app.request('/v1/admin/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hfToken: 'fixture-token' }),
      }));
      assert.equal(calls, 1);
      assert.equal(hostile.accesses(), 0);
      assert.equal(f.onErrorCalls(), 0);
    });
  }

  it('contains a circuit-breaker state read failure and restores the global method', async () => {
    const hostile = hostileFailure();
    const breaker = getCircuitBreakerV2();
    const descriptor = Object.getOwnPropertyDescriptor(breaker, 'getAllStates');
    let calls = 0;
    try {
      Object.defineProperty(breaker, 'getAllStates', {
        configurable: true,
        value() { calls++; throw hostile.failure; },
      });
      const f = fixture();
      await assertInternal(await f.app.request('/v1/admin/reset-circuit-breaker/fixture-provider', {
        method: 'POST',
      }));
      assert.equal(calls, 1);
      assert.equal(hostile.accesses(), 0);
      assert.equal(f.onErrorCalls(), 0);
    } finally {
      if (descriptor) Object.defineProperty(breaker, 'getAllStates', descriptor);
      else Reflect.deleteProperty(breaker, 'getAllStates');
    }
  });

  it('contains a structural cost-tracker flush failure without constructing CostTracker', async () => {
    const hostile = hostileFailure();
    let calls = 0;
    const tracker = {
      bufferSize: 1,
      flush() { calls++; throw hostile.failure; },
    };
    const f = fixture({ costTracker: tracker });
    await assertInternal(await f.app.request('/v1/admin/flush-usage', { method: 'POST' }));
    assert.equal(calls, 1);
    assert.equal(hostile.accesses(), 0);
    assert.equal(f.onErrorCalls(), 0);
  });

  for (const route of [
    { method: 'POST', path: '/v1/admin/keys', body: { userId: 'fixture-user' } },
    { method: 'GET', path: '/v1/admin/keys' },
    { method: 'DELETE', path: '/v1/admin/keys/fixture-key' },
  ] as const) {
    it(`${route.method} ${route.path} preserves database NOT_CONFIGURED`, async () => {
      const f = fixture();
      const response = await f.app.request(route.path, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        ...('body' in route ? { body: JSON.stringify(route.body) } : {}),
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Database not configured', code: 'NOT_CONFIGURED' });
      assert.equal(f.onErrorCalls(), 0);
    });
  }

  it('preserves catalog NOT_CONFIGURED before loading the catalog', async () => {
    let calls = 0;
    const f = fixture({
      services: throwingServices('loadCatalog', () => { calls++; }, new Error(CANARY)),
    });
    const response = await f.app.request('/v1/admin/catalog/refresh', { method: 'POST' });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: 'Free model router not configured', code: 'NOT_CONFIGURED',
    });
    assert.equal(calls, 0);
    assert.equal(f.onErrorCalls(), 0);
  });

  it('preserves flush NOT_CONFIGURED without a tracker', async () => {
    const f = fixture();
    const response = await f.app.request('/v1/admin/flush-usage', { method: 'POST' });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Cost tracker not configured', code: 'NOT_CONFIGURED' });
    assert.equal(f.onErrorCalls(), 0);
  });
});
