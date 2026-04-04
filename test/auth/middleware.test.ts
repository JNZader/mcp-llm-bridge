/**
 * Tests for API Key Auth Middleware (Hono).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { Hono } from 'hono';

import { apiKeyAuth } from '../../src/auth/middleware.js';
import { createApiKey, revokeApiKey } from '../../src/auth/keys.js';
import { initializeDb } from '../../src/vault/schema.js';
import type { UserContext } from '../../src/auth/types.js';

function createTestDb(): { db: Database.Database; path: string } {
  const path = join(tmpdir(), `mlb-test-${randomUUID()}.db`);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  initializeDb(db);
  return { db, path };
}

/**
 * Build a minimal Hono app with auth middleware and a test route.
 */
type Env = {
  Variables: { userContext: UserContext };
};

function buildApp(db: Database.Database) {
  const app = new Hono<Env>();

  app.use('/api/*', apiKeyAuth(db));

  app.get('/api/test', (c) => {
    const ctx = c.get('userContext');
    return c.json({ userId: ctx.userId, apiKeyId: ctx.apiKeyId, trustLevel: ctx.trustLevel });
  });

  return app;
}

describe('apiKeyAuth middleware', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    dbPath = result.path;
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('valid key sets UserContext on Hono context', async () => {
    const app = buildApp(db);
    const { plaintextKey } = createApiKey(db, { userId: 'user-1', trustLevel: 'open' });

    const res = await app.request('/api/test', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { userId: string; trustLevel: string };
    assert.equal(body.userId, 'user-1');
    assert.equal(body.trustLevel, 'open');
  });

  it('missing Authorization header returns 401', async () => {
    const app = buildApp(db);

    const res = await app.request('/api/test');
    assert.equal(res.status, 401);

    const body = await res.json() as { code: string };
    assert.equal(body.code, 'MISSING_AUTH');
  });

  it('invalid Bearer format returns 401', async () => {
    const app = buildApp(db);

    // No "Bearer" prefix
    const res1 = await app.request('/api/test', {
      headers: { Authorization: 'Token abc123' },
    });
    assert.equal(res1.status, 401);
    const body1 = await res1.json() as { code: string };
    assert.equal(body1.code, 'INVALID_AUTH_FORMAT');

    // Just "Bearer" with no token
    const res2 = await app.request('/api/test', {
      headers: { Authorization: 'Bearer' },
    });
    assert.equal(res2.status, 401);

    // Too many parts
    const res3 = await app.request('/api/test', {
      headers: { Authorization: 'Bearer token extra' },
    });
    assert.equal(res3.status, 401);
  });

  it('revoked key returns 401 with KEY_REVOKED code', async () => {
    const app = buildApp(db);
    const { apiKey, plaintextKey } = createApiKey(db, { userId: 'user-1' });
    revokeApiKey(db, apiKey.id);

    const res = await app.request('/api/test', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });

    assert.equal(res.status, 401);
    const body = await res.json() as { code: string };
    assert.equal(body.code, 'KEY_REVOKED');
  });

  it('expired key returns 401 with KEY_EXPIRED code', async () => {
    const app = buildApp(db);
    const { plaintextKey } = createApiKey(db, {
      userId: 'user-1',
      expiresAt: '2000-01-01T00:00:00Z',
    });

    const res = await app.request('/api/test', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });

    assert.equal(res.status, 401);
    const body = await res.json() as { code: string };
    assert.equal(body.code, 'KEY_EXPIRED');
  });

  it('non-existent key returns 401 with INVALID_KEY code', async () => {
    const app = buildApp(db);

    const res = await app.request('/api/test', {
      headers: { Authorization: 'Bearer mlb_sk_0000000000000000000000000000dead' },
    });

    assert.equal(res.status, 401);
    const body = await res.json() as { code: string };
    assert.equal(body.code, 'INVALID_KEY');
  });

  it('rate-limited key returns 429 with Retry-After header', async () => {
    const app = buildApp(db);
    // Key with max 1 request per 60s window
    const { apiKey, plaintextKey } = createApiKey(db, {
      userId: 'user-1',
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
    });

    // Insert a usage_logs entry to simulate a prior request in the window
    db.prepare(
      `INSERT INTO usage_logs (provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, created_at)
       VALUES ('test', ?, 'test-model', '_global', 0, 0, 0, 0, 1, datetime('now'))`,
    ).run(apiKey.id);

    const res = await app.request('/api/test', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });

    assert.equal(res.status, 429);
    const retryAfter = res.headers.get('Retry-After');
    assert.ok(retryAfter, 'should have Retry-After header');
    assert.ok(Number(retryAfter) > 0, 'Retry-After should be positive');

    const body = await res.json() as { code: string };
    assert.equal(body.code, 'RATE_LIMITED');
  });
});
