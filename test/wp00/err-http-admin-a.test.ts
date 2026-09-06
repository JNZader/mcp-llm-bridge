import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { safeError, toSafeHttpError } from '../../src/core/safe-error.js';
import { initializeDb } from '../../src/vault/schema.js';
import { registerAdminApiKeyRoutes } from '../../src/server/routes/admin/api-keys.js';
import { registerAdminSecurityProfileRoutes } from '../../src/server/routes/admin/security-profiles.js';

const CANARY = 'private-admin-canary';
const INTERNAL = toSafeHttpError(safeError('INTERNAL_ERROR')).body.error;
const INVALID = toSafeHttpError(safeError('INVALID_REQUEST')).body.error;
const NOT_FOUND = 'The requested resource was not found.';
const keyBody = { userId: 'fixture-user' };
const profileBody = { project: 'fixture-project', allowedCategories: ['read'] };
const routes = [
  { method: 'POST', path: '/v1/admin/keys', body: keyBody },
  { method: 'GET', path: '/v1/admin/keys' },
  { method: 'DELETE', path: `/v1/admin/keys/${CANARY}` },
  { method: 'POST', path: '/v1/admin/profiles', body: profileBody },
  { method: 'GET', path: '/v1/admin/profiles' },
  { method: 'DELETE', path: `/v1/admin/profiles/${CANARY}` },
] as const;

function fixture(db?: Database.Database) {
  const app = new Hono();
  let escaped = 0;
  app.onError((_error, c) => { escaped++; return c.json({ unexpected_fallback: true }, 500); });
  // Handler-only fixture: authentication and CSRF middleware are intentionally not mounted.
  registerAdminApiKeyRoutes(app, { db });
  registerAdminSecurityProfileRoutes(app, { db });
  return { app, escaped: () => escaped };
}

function realDb(t: TestContext) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  initializeDb(db);
  return db;
}

function request(app: Hono, method: string, path: string, body?: unknown) {
  return app.request(path, { method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function assertError(response: Response, status: number, expected: unknown) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(body, expected);
  assert.equal(JSON.stringify(body).includes(CANARY), false);
}

describe('Admin key and profile error containment', { concurrency: false }, () => {
  for (const route of routes) {
    for (const kind of ['error', 'string', 'getter', 'coercion', 'proxy', 'fake-issues', 'not-found-text']) {
      it(`${route.method} ${route.path}: ${kind} remains a private-free operational 500`, async () => {
        let accesses = 0;
        let thrown: unknown = kind === 'string' ? CANARY : new Error(CANARY);
        if (kind === 'getter') Object.defineProperty(thrown, 'message', { get() { accesses++; throw new Error(CANARY); } });
        if (kind === 'coercion') thrown = { get [Symbol.toPrimitive]() { accesses++; throw new Error(CANARY); } };
        if (kind === 'proxy') thrown = new Proxy({}, {
          get() { accesses++; throw new Error(CANARY); },
          getPrototypeOf() { accesses++; throw new Error(CANARY); },
        });
        if (kind === 'fake-issues') thrown = { issues: [{ message: CANARY, path: [CANARY] }] };
        if (kind === 'not-found-text') thrown = new Error(`No API key found; No profile found: ${CANARY}`);
        let calls = 0;
        const db = { prepare() { calls++; throw thrown; } } as unknown as Database.Database;
        const f = fixture(db);
        await assertError(await request(f.app, route.method, route.path, 'body' in route ? route.body : undefined), 500, { error: INTERNAL });
        assert.equal(calls, 1);
        assert.equal(accesses, 0);
        assert.equal(f.escaped(), 0);
      });
    }

    it(`${route.method} ${route.path}: preserves NOT_CONFIGURED`, async () => {
      const f = fixture();
      await assertError(await request(f.app, route.method, route.path, 'body' in route ? route.body : undefined), 500,
        { error: 'Database not configured', code: 'NOT_CONFIGURED' });
    });
  }

  const validation = [
    { path: '/v1/admin/keys', valid: keyBody, fields: {
      userId: '', project: 7, trustLevel: CANARY, rateLimitMax: 0,
      rateLimitWindowMs: 0, budgetUsd: -1, expiresAt: 7,
    } },
    { path: '/v1/admin/profiles', valid: profileBody, fields: {
      project: '', trustLevel: CANARY, allowedCategories: [CANARY],
      rateLimitMax: 0, rateLimitWindowMs: 0, sandbox: CANARY,
    } },
  ];
  for (const entry of validation) {
    for (const [field, value] of Object.entries(entry.fields)) {
      it(`${entry.path}: finite validation detail for ${field} without database writes`, async () => {
        let calls = 0;
        const f = fixture({ prepare() { calls++; throw new Error('Unexpected write'); } } as unknown as Database.Database);
        await assertError(await request(f.app, 'POST', entry.path, { ...entry.valid, [field]: value }), 400,
          { error: INVALID, details: { formErrors: [], fieldErrors: { [field]: [INVALID] } } });
        assert.equal(calls, 0);
      });
    }
    it(`${entry.path}: preserves top-level form error shape`, async () => {
      const f = fixture({} as Database.Database);
      await assertError(await request(f.app, 'POST', entry.path, null), 400,
        { error: INVALID, details: { formErrors: [INVALID], fieldErrors: {} } });
    });
    it(`${entry.path}: malformed JSON retains existing 500 without reflecting parser text`, async () => {
      const f = fixture({} as Database.Database);
      const response = await f.app.request(entry.path, { method: 'POST', body: `{"${CANARY}":` });
      await assertError(response, 500, { error: INTERNAL });
    });
  }

  it('real SQLite preserves key creation disclosure, masked listing and non-destructive revocation', async (t) => {
    const db = realDb(t);
    const { app } = fixture(db);
    const created = await request(app, 'POST', '/v1/admin/keys', keyBody);
    assert.equal(created.status, 201);
    const key = await created.json() as Record<string, unknown>;
    assert.equal(key.ok, true);
    assert.equal(key.userId, keyBody.userId);
    assert.match(String(key.key), /^mlb_sk_[a-f0-9]{32}$/);
    const stored = db.prepare('SELECT key_hash, enabled FROM api_keys WHERE id = ?').get(key.id) as { key_hash: string; enabled: number };
    assert.equal(stored.key_hash, createHash('sha256').update(String(key.key)).digest('hex'));
    const listed = await request(app, 'GET', '/v1/admin/keys');
    assert.equal(listed.status, 200);
    const listing = await listed.json() as { keys: Record<string, unknown>[] };
    assert.equal(listing.keys.length, 1);
    assert.equal(listing.keys[0]?.keyPrefix, key.keyPrefix);
    assert.equal(JSON.stringify(listing).includes(String(key.key)), false);
    assert.equal(JSON.stringify(listing).includes(stored.key_hash), false);
    const deleted = await request(app, 'DELETE', `/v1/admin/keys/${key.id}`);
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true, id: key.id, message: `API key ${key.id} revoked` });
    assert.deepEqual(db.prepare('SELECT enabled FROM api_keys WHERE id = ?').get(key.id), { enabled: 0 });
  });

  it('real SQLite preserves profile creation, listing and deletion', async (t) => {
    const db = realDb(t);
    const { app } = fixture(db);
    const created = await request(app, 'POST', '/v1/admin/profiles', profileBody);
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { ok: true, ...profileBody, trustLevel: 'restricted',
      rateLimitMax: null, rateLimitWindowMs: null, sandbox: false });
    const listed = await request(app, 'GET', '/v1/admin/profiles');
    assert.equal(listed.status, 200);
    const body = await listed.json() as { profiles: Record<string, unknown>[] };
    assert.equal(body.profiles.length, 1);
    assert.equal(body.profiles[0]?.project, profileBody.project);
    assert.deepEqual(body.profiles[0]?.allowedCategories, ['read']);
    const deleted = await request(app, 'DELETE', `/v1/admin/profiles/${profileBody.project}`);
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true, project: profileBody.project,
      message: `Profile for "${profileBody.project}" deleted` });
    assert.equal(db.prepare('SELECT * FROM security_profiles WHERE project = ?').get(profileBody.project), undefined);
  });

  for (const resource of ['keys', 'profiles']) {
    it(`real SQLite missing ${resource} yields fixed 404 without identifier reflection`, async (t) => {
      const { app } = fixture(realDb(t));
      await assertError(await request(app, 'DELETE', `/v1/admin/${resource}/${CANARY}`), 404,
        { error: NOT_FOUND, code: 'NOT_FOUND' });
    });
  }
});
