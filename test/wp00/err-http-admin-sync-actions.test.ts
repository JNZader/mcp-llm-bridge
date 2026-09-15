import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ModelSyncManager, ModelSyncAlreadyRunningError } from '../../src/model-sync/index.js';
import { PriceManager, PriceSyncAlreadyRunningError } from '../../src/price-sync/index.js';
import { registerAdminSyncRoutes } from '../../src/server/routes/admin/sync.js';
import type { Vault } from '../../src/vault/vault.js';

const MODELS = '/v1/admin/models/sync';
const PRICES = '/v1/admin/prices/sync';
const CANARY = 'private-sync-action-canary';
const SAFE = 'An unexpected internal error occurred.';
const priceSummary = { timestamp: 42, updated: 2, added: 1, unchanged: 3, error: CANARY };
const modelSummary = { provider: 'openai' as const, timestamp: 42,
  modelsFound: 3, modelsAdded: 2, modelsRemoved: 1, error: CANARY };

function statuses() {
  const timing = { isRunning: true, startedAt: 43, lastCompletedAt: 42,
    lastSuccessAt: 41, lastError: CANARY };
  return {
    model: { ...timing, provider: 'openai' as const, lastResultSummary: { ...modelSummary } },
    price: { ...timing, lastResultSummary: { ...priceSummary } },
  };
}

async function fixture(run: (app: Hono, db: Database.Database) => Promise<void>) {
  const db = new Database(':memory:');
  const modelMethod = ModelSyncManager.prototype.syncProvider;
  const priceMethod = PriceManager.prototype.syncPrices;
  const originalFetch = global.fetch;
  try {
    for (const migration of ['004_model_sync.sql', '005_price_sync.sql']) {
      db.exec(readFileSync(new URL('../../src/migrations/' + migration, import.meta.url), 'utf8'));
    }
    global.fetch = async () => { throw new Error('Unexpected transport invocation'); };
    const app = new Hono();
    app.onError(() => new Response('Unexpected Hono fallback', { status: 599 }));
    registerAdminSyncRoutes(app, { db, vault: {} as Vault });
    await run(app, db);
  } finally {
    ModelSyncManager.prototype.syncProvider = modelMethod;
    PriceManager.prototype.syncPrices = priceMethod;
    global.fetch = originalFetch;
    db.close();
  }
}

function post(app: Hono, path: string) {
  return app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(path === MODELS
      ? { provider: 'openai', apiKey: CANARY, baseUrl: 'https://fixture.invalid/v1' } : {}) });
}

function throwFromManager(path: string, value: unknown) {
  if (path === MODELS) ModelSyncManager.prototype.syncProvider = async () => { throw value; };
  else PriceManager.prototype.syncPrices = async () => { throw value; };
}

function genuineConflict(path: string) {
  const state = statuses();
  return path === MODELS
    ? new ModelSyncAlreadyRunningError(state.model)
    : new PriceSyncAlreadyRunningError(state.price);
}

describe('Sync action HTTP error boundaries', { concurrency: false }, () => {
  for (const path of [MODELS, PRICES]) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'imitation', 'wrapped']) {
      it(path + ': contains unknown ' + kind + ' without inspection', async () => {
        await fixture(async (app) => {
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
          if (kind === 'imitation') {
            value = Object.create(path === MODELS
              ? ModelSyncAlreadyRunningError.prototype : PriceSyncAlreadyRunningError.prototype);
            Object.defineProperty(value, 'status', { get: inspect });
          }
          if (kind === 'wrapped') value = new Proxy(genuineConflict(path), {});
          throwFromManager(path, value);
          const res = await post(app, path);
          assert.equal(res.status, 500);
          assert.equal(accesses, 0);
          assert.deepEqual(await res.json(), { error: SAFE, code: 'INTERNAL_ERROR' });
        });
      });
    }

    it(path + ': preserves genuine conflict identity and projects historical diagnostics', async () => {
      await fixture(async (app) => {
        const error = genuineConflict(path);
        const original = JSON.stringify(error.status);
        let accesses = 0;
        Object.defineProperty(error, 'message', { get() { accesses++; throw new Error(CANARY); } });
        throwFromManager(path, error);
        const res = await post(app, path);
        assert.equal(res.status, 409);
        const state = statuses();
        const activeRun = path === MODELS
          ? { ...state.model, lastError: SAFE, lastResultSummary: { ...modelSummary, error: SAFE } }
          : { ...state.price, lastError: SAFE, lastResultSummary: { ...priceSummary, error: SAFE } };
        const body = await res.json();
        assert.deepEqual(body, {
          error: path === MODELS ? 'Model sync already running' : 'Price sync already running',
          code: 'SYNC_ALREADY_RUNNING',
          details: { ...(path === MODELS ? { provider: 'openai' } : {}), activeRun },
        });
        assert.equal(JSON.stringify(body).includes(CANARY), false);
        assert.equal(JSON.stringify(error.status), original);
        assert.equal(accesses, 0);
      });
    });

    it(path + ': real overlapping manager calls return 409 and complete the first run', { timeout: 5000 }, async () => {
      await fixture(async (app, db) => {
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { entered = resolve; });
        let calls = 0;
        global.fetch = async () => {
          calls++;
          entered();
          await gate;
          return Response.json(path === MODELS ? { data: [] } : { providers: {} });
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Transport did not start')), 1000);
        });
        const first = post(app, path);
        try {
          await Promise.race([started, deadline]);
          const overlap = await post(app, path);
          assert.equal(overlap.status, 409);
          const body = await overlap.json();
          assert.equal(body.code, 'SYNC_ALREADY_RUNNING');
          assert.equal(body.error, path === MODELS ? 'Model sync already running' : 'Price sync already running');
          assert.equal(body.details.activeRun.isRunning, true);
          assert.equal(typeof body.details.activeRun.startedAt, 'number');
          assert.equal(calls, 1);
          release();
          assert.equal((await first).status, 200);
          const status = path === MODELS
            ? new ModelSyncManager(db).getRunStatus('openai') : new PriceManager(db).getRunStatus();
          assert.equal(status.isRunning, false);
          assert.equal(status.startedAt, null);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          release();
          await first;
        }
      });
    });
  }

  for (const diagnostic of ['value', 'getter', 'null', 'absent']) {
    it('price result preserves metadata and ' + diagnostic + ' diagnostic presence without inspection', async () => {
      await fixture(async (app) => {
        const result = { timestamp: 42, updated: 2, added: 1, unchanged: 3 };
        let accesses = 0;
        if (diagnostic !== 'absent') Object.defineProperty(result, 'error', diagnostic === 'getter'
          ? { enumerable: true, get() { accesses++; throw new Error(CANARY); } }
          : { enumerable: true, value: diagnostic === 'null' ? null : CANARY });
        const descriptor = Object.getOwnPropertyDescriptor(result, 'error');
        PriceManager.prototype.syncPrices = async () => result;
        const res = await post(app, PRICES);
        assert.equal(res.status, 200);
        assert.equal(accesses, 0);
        assert.deepEqual(await res.json(), { ok: true, synced: 3, details: {
          timestamp: 42, updated: 2, added: 1, unchanged: 3,
          ...(diagnostic === 'absent' ? {} : { error: diagnostic === 'null' ? null : SAFE }),
        } });
        assert.deepEqual(Object.getOwnPropertyDescriptor(result, 'error'), descriptor);
      });
    });
  }

  it('normal model success preserves model payload and counters', async () => {
    await fixture(async (app) => {
      const model = { id: 'fixture-model', name: 'Fixture Model' };
      ModelSyncManager.prototype.syncProvider = async () => ({
        provider: 'openai', timestamp: 42, modelsFound: [model], modelsAdded: [model], modelsRemoved: ['old'],
      });
      const res = await post(app, MODELS);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, provider: 'openai', timestamp: 42,
        synced: 1, models: [model], added: [model], removed: ['old'] });
    });
  });
});
