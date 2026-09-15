import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { ModelSyncManager, PROVIDER_TYPE, type ModelSyncConfig } from '../../src/model-sync/index.js';
import { PriceManager } from '../../src/price-sync/index.js';
import { registerAdminSyncRoutes } from '../../src/server/routes/admin/sync.js';
import type { Vault } from '../../src/vault/vault.js';

const MODELS = '/v1/admin/models/sync';
const PRICES = '/v1/admin/prices/sync';
const CANARY = 'private-sync-validation-canary';
const providers = Object.values(PROVIDER_TYPE);
const priceResult = { added: 2, updated: 1, unchanged: 3, timestamp: 42 };

async function fixture(run: (f: {
  app: Hono; calls: ModelSyncConfig[]; priceCalls: () => number; vaultCalls: () => number;
}) => Promise<void>, options: { configured?: boolean; vaultKey?: string; envKey?: string } = {}) {
  const db = new Database(':memory:');
  const modelMethod = ModelSyncManager.prototype.syncProvider;
  const priceMethod = PriceManager.prototype.syncPrices;
  const env = providers.map((provider) => {
    const key = provider.toUpperCase() + '_API_KEY';
    return { key, value: process.env[key] };
  });
  try {
    for (const { key } of env) delete process.env[key];
    if (options.envKey !== undefined) process.env.OPENAI_API_KEY = options.envKey;
    for (const migration of ['004_model_sync.sql', '005_price_sync.sql']) {
      db.exec(readFileSync(new URL('../../src/migrations/' + migration, import.meta.url), 'utf8'));
    }
    const calls: ModelSyncConfig[] = [];
    let priceCalls = 0;
    let vaultCalls = 0;
    ModelSyncManager.prototype.syncProvider = async (config) => {
      calls.push(config);
      return { provider: config.provider, modelsFound: [], modelsAdded: [],
        modelsRemoved: [], timestamp: 42 };
    };
    PriceManager.prototype.syncPrices = async () => { priceCalls++; return priceResult; };
    const vault = {
      getDecrypted(provider: string, key: string) {
        vaultCalls++;
        assert.ok(providers.includes(provider as typeof providers[number]));
        assert.equal(key, 'default');
        if (options.vaultKey === undefined) throw new Error(CANARY);
        return options.vaultKey;
      },
    } as unknown as Vault;
    const app = new Hono();
    registerAdminSyncRoutes(app, { db: options.configured === false ? undefined : db, vault });
    await run({ app, calls, priceCalls: () => priceCalls, vaultCalls: () => vaultCalls });
  } finally {
    ModelSyncManager.prototype.syncProvider = modelMethod;
    PriceManager.prototype.syncPrices = priceMethod;
    for (const { key, value } of env) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    db.close();
  }
}

function post(app: Hono, path: string, body: unknown) {
  return app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

describe('Sync POST validation and credential projections', { concurrency: false }, () => {
  for (const path of [MODELS, PRICES]) {
    for (const value of [CANARY, { nested: CANARY }, null, 7]) {
      it(`${path}: rejects invalid provider without reflected input ${JSON.stringify(value)}`, async () => {
        await fixture(async (f) => {
          const res = await post(f.app, path, { provider: value });
          assert.equal(res.status, 400);
          const body = await res.json();
          assert.deepEqual(body, {
            error: path === MODELS ? 'Invalid provider for provider' : 'Invalid provider for provider parameter',
            code: 'VALIDATION_ERROR', details: { field: 'provider', supportedProviders: providers },
          });
          assert.equal(JSON.stringify(body).includes(CANARY), false);
          assert.equal(f.calls.length + f.priceCalls() + f.vaultCalls(), 0);
        });
      });
    }

    it(`${path}: preserves NOT_CONFIGURED before parsing or credential access`, async () => {
      await fixture(async (f) => {
        const res = await post(f.app, path, {});
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: 'Database not configured', code: 'NOT_CONFIGURED' });
        assert.equal(f.calls.length + f.priceCalls() + f.vaultCalls(), 0);
      }, { configured: false });
    });

    for (const raw of ['null', '[]', '7', '{broken', '']) {
      it(`${path}: preserves body parsing behavior for ${JSON.stringify(raw)}`, async () => {
        await fixture(async (f) => {
          const res = await f.app.request(path, { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: raw });
          const optionalPriceBody = path === PRICES && (raw === '' || raw === '{broken');
          assert.equal(res.status, optionalPriceBody ? 200 : 400);
          assert.deepEqual(await res.json(), optionalPriceBody
            ? { ok: true, synced: 3, details: priceResult }
            : { error: 'Request body must be a JSON object', code: 'INVALID_JSON', details: { expected: 'object' } });
          assert.equal(f.calls.length + f.vaultCalls(), 0);
          assert.equal(f.priceCalls(), optionalPriceBody ? 1 : 0);
        });
      });
    }
  }

  for (const provider of providers) {
    it(`missing ${provider} credentials returns canonical instructions without starting sync`, async () => {
      await fixture(async (f) => {
        const res = await post(f.app, MODELS, { provider });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), {
          error: 'Provider credentials are not configured.', code: 'MISSING_CREDENTIALS',
          details: { provider, resolution: ['REQUEST_API_KEY', 'PROVIDER_ENV_KEY', 'DEFAULT_VAULT_CREDENTIAL'] },
        });
        assert.equal(f.vaultCalls(), 1);
        assert.equal(f.calls.length + f.priceCalls(), 0);
      });
    });

    it(`price provider scope ${provider} remains unsupported without received reflection`, async () => {
      await fixture(async (f) => {
        const res = await post(f.app, PRICES, { provider });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), {
          error: 'Provider-scoped price sync is not supported by this endpoint',
          code: 'UNSUPPORTED_PARAMETER', details: { field: 'provider' },
        });
        assert.equal(f.calls.length + f.priceCalls() + f.vaultCalls(), 0);
      });
    });
  }

  for (const source of ['request', 'environment', 'vault']) {
    it(`uses ${source} credential precedence without public disclosure`, async () => {
      await fixture(async (f) => {
        const res = await post(f.app, MODELS, {
          provider: 'openai', ...(source === 'request' ? { apiKey: CANARY + '-request' } : {}),
          baseUrl: 'https://fixture.invalid/v1', matchRegex: '^fixture', autoSyncIntervalMs: 123,
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body, { ok: true, provider: 'openai', synced: 0,
          models: [], added: [], removed: [], timestamp: 42 });
        assert.equal(JSON.stringify(body).includes(CANARY), false);
        assert.deepEqual(f.calls, [{
          provider: 'openai', apiKey: CANARY + '-' + source, baseUrl: 'https://fixture.invalid/v1',
          matchRegex: '^fixture', autoSyncIntervalMs: 123,
        }]);
        assert.equal(f.vaultCalls(), source === 'vault' ? 1 : 0);
        assert.equal(f.priceCalls(), 0);
      }, { envKey: source === 'vault' ? undefined : CANARY + '-environment', vaultKey: CANARY + '-vault' });
    });
  }
});
