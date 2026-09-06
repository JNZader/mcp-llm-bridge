import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { safeError } from '../../src/core/safe-error.js';
import { ModelSyncManager, PROVIDER_TYPE } from '../../src/model-sync/index.js';
import { PriceManager } from '../../src/price-sync/index.js';
import { registerAdminSyncRoutes } from '../../src/server/routes/admin/sync.js';
import type { Vault } from '../../src/vault/vault.js';

const CANARY = 'private-sync-readback-canary';
const INTERNAL = safeError('INTERNAL_ERROR').message;
const routes = [
  { path: '/v1/admin/models/sync/status?provider=openai', model: true, method: 'getRunStatus' },
  { path: '/v1/admin/models/sync/history', model: true, method: 'getSyncHistory' },
  { path: '/v1/admin/prices/sync/status', model: false, method: 'getRunStatus' },
  { path: '/v1/admin/prices/sync/history', model: false, method: 'getSyncHistory' },
] as const;

function fixture(t: TestContext, configured = true) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  for (const migration of ['004_model_sync.sql', '005_price_sync.sql']) {
    db.exec(readFileSync(new URL('../../src/migrations/' + migration, import.meta.url), 'utf8'));
  }
  const app = new Hono();
  let escaped = 0;
  app.onError((_error, c) => { escaped++; return c.json({ unexpected_fallback: true }, 500); });
  const vault = { getDecrypted() { assert.fail('GET must not read credentials'); } } as unknown as Vault;
  registerAdminSyncRoutes(app, { db: configured ? db : undefined, vault });
  return { app, db, escaped: () => escaped };
}

async function patchMethod(target: object, key: string, value: () => unknown, run: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  assert.ok(original);
  try {
    Object.defineProperty(target, key, { ...original, value });
    await run();
  } finally {
    Object.defineProperty(target, key, original);
  }
}

describe('Sync GET error readback containment', { concurrency: false }, () => {
  for (const route of routes) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'revoked']) {
      it(`${route.path}: contains ${kind} as canonical INTERNAL_ERROR`, async (t) => {
        const f = fixture(t);
        let accesses = 0;
        let thrown: unknown = new Error(CANARY);
        if (kind === 'string') thrown = CANARY;
        if (kind === 'getter') Object.defineProperty(thrown, 'message', {
          get() { accesses++; throw new Error(CANARY); },
        });
        if (kind === 'coercion') thrown = {
          get [Symbol.toPrimitive]() { accesses++; throw new Error(CANARY); },
        };
        if (kind === 'revoked') {
          const pair = Proxy.revocable({}, {});
          pair.revoke();
          thrown = pair.proxy;
        }
        const prototype = route.model ? ModelSyncManager.prototype : PriceManager.prototype;
        let calls = 0;
        await patchMethod(prototype, route.method, () => { calls++; throw thrown; }, async () => {
          const res = await f.app.request(route.path);
          assert.equal(res.status, 500);
          assert.deepEqual(await res.json(), { error: INTERNAL, code: 'INTERNAL_ERROR' });
          assert.equal(calls, 1);
          assert.equal(accesses, 0);
          assert.equal(f.escaped(), 0);
        });
      });
    }

    it(`${route.path}: retains NOT_CONFIGURED`, async (t) => {
      const f = fixture(t, false);
      const res = await f.app.request(route.path);
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: 'Database not configured', code: 'NOT_CONFIGURED' });
    });
  }

  for (const model of [true, false]) {
    for (const diagnostic of [CANARY, null, undefined]) {
      it(`${model ? 'model' : 'price'} status preserves metadata and diagnostic nullability: ${String(diagnostic)}`, async (t) => {
        const f = fixture(t);
        const summary = model
          ? { provider: 'openai', timestamp: 12, modelsFound: 3, modelsAdded: 2, modelsRemoved: 1, error: diagnostic }
          : { timestamp: 12, updated: 3, added: 2, unchanged: 1, error: diagnostic };
        const status = {
          ...(model ? { provider: 'openai' } : {}),
          isRunning: true, startedAt: 20, lastCompletedAt: 12, lastSuccessAt: 10,
          lastError: diagnostic, lastResultSummary: summary,
        };
        const before = structuredClone(status);
        const projected = {
          ...status, lastError: diagnostic == null ? diagnostic : INTERNAL,
          lastResultSummary: { ...summary, error: diagnostic == null ? diagnostic : INTERNAL },
        };
        await patchMethod(model ? ModelSyncManager.prototype : PriceManager.prototype,
          'getRunStatus', () => status, async () => {
            const res = await f.app.request(model ? routes[0].path : routes[2].path);
            assert.equal(res.status, 200);
            const body = await res.json();
            const expected = model ? { statuses: [projected], count: 1 } : projected;
            assert.deepEqual(body, JSON.parse(JSON.stringify(expected)));
            assert.equal(JSON.stringify(body).includes(CANARY), false);
            assert.deepEqual(status, before);
          });
      });
    }

    it(`${model ? 'model' : 'price'} history preserves real rows, order, filters and stored errors`, async (t) => {
      const f = fixture(t);
      const table = model ? 'model_sync_log' : 'price_sync_log';
      if (model) {
        f.db.prepare('INSERT INTO model_sync_log(provider,synced_at,models_found,models_added,models_removed,error) VALUES (?,?,?,?,?,?)')
          .run('openai', 10, 3, 2, 1, CANARY);
        f.db.prepare('INSERT INTO model_sync_log(provider,synced_at,models_found,models_added,models_removed,error) VALUES (?,?,?,?,?,?)')
          .run('openai', 20, 4, 1, 0, null);
      } else {
        f.db.prepare('INSERT INTO price_sync_log(synced_at,models_updated,models_added,error) VALUES (?,?,?,?)')
          .run(10, 3, 2, CANARY);
        f.db.prepare('INSERT INTO price_sync_log(synced_at,models_updated,models_added,error) VALUES (?,?,?,?)')
          .run(20, 4, 1, null);
      }
      const original = model
        ? new ModelSyncManager(f.db).getSyncHistory('openai', 2)
        : new PriceManager(f.db).getSyncHistory(2);
      const path = (model ? routes[1].path + '?provider=openai&' : routes[3].path + '?') + 'limit=2';
      const res = await f.app.request(path);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        history: original.map((entry) => ({ ...entry, error: entry.error === null ? null : INTERNAL })),
        count: 2,
      });
      const limited = await f.app.request(path.replace('limit=2', 'limit=1'));
      assert.deepEqual(await limited.json(), { history: [original[0]], count: 1 });
      const stored = f.db.prepare<[], { error: string }>('SELECT error FROM ' + table + ' WHERE id=1').get();
      assert.equal(stored?.error, CANARY);
    });
  }

  const validations = [
    { path: routes[0].path.replace('openai', CANARY), field: 'provider' },
    { path: routes[1].path + '?provider=' + CANARY, field: 'provider' },
    { path: routes[1].path + '?limit=' + CANARY, field: 'limit' },
    { path: routes[3].path + '?limit=' + CANARY, field: 'limit' },
    { path: routes[3].path + '?limit=0', field: 'limit' },
    { path: routes[1].path + '?limit=501', field: 'limit' },
  ];
  for (const entry of validations) {
    it(`finite GET validation: ${entry.path}`, async (t) => {
      const f = fixture(t);
      const res = await f.app.request(entry.path);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.deepEqual(body, {
        error: entry.field === 'provider' ? 'Invalid provider for provider' : 'Invalid numeric value for limit',
        code: 'VALIDATION_ERROR',
        details: entry.field === 'provider'
          ? { field: 'provider', supportedProviders: Object.values(PROVIDER_TYPE) }
          : { field: 'limit', min: 1, max: 500 },
      });
      assert.equal(JSON.stringify(body).includes(CANARY), false);
      assert.equal(f.escaped(), 0);
    });
  }
});
