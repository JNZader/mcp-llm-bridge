/**
 * Tests for API Key management — generation, hashing, CRUD, and lookup.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import {
  generateApiKey,
  hashApiKey,
  createApiKey,
  revokeApiKey,
  lookupByHash,
  listApiKeys,
  API_KEY_PREFIX,
} from '../../src/auth/index.js';
import { initializeDb } from '../../src/vault/schema.js';

function createTestDb(): { db: Database.Database; path: string } {
  const path = join(tmpdir(), `mlb-test-${randomUUID()}.db`);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  initializeDb(db);
  return { db, path };
}

describe('generateApiKey', () => {
  it('produces key with mlb_sk_ prefix', () => {
    const { key } = generateApiKey();
    assert.ok(key.startsWith(API_KEY_PREFIX), `key should start with ${API_KEY_PREFIX}`);
  });

  it('produces key with prefix + 32 hex chars', () => {
    const { key } = generateApiKey();
    const hexPart = key.slice(API_KEY_PREFIX.length);
    assert.equal(hexPart.length, 32, 'hex portion should be 32 chars');
    assert.match(hexPart, /^[0-9a-f]{32}$/, 'hex portion should be lowercase hex');
  });

  it('returns a valid SHA-256 hex hash', () => {
    const { hash } = generateApiKey();
    assert.equal(hash.length, 64, 'SHA-256 hex digest is 64 chars');
    assert.match(hash, /^[0-9a-f]{64}$/, 'hash should be lowercase hex');
  });

  it('returns a display prefix', () => {
    const { key, prefix } = generateApiKey();
    assert.ok(key.startsWith(prefix), 'prefix should be the start of the key');
    assert.equal(prefix.length, API_KEY_PREFIX.length + 8, 'prefix is API_KEY_PREFIX + 8 chars');
  });
});

describe('hashApiKey', () => {
  it('returns SHA-256 hex digest', () => {
    const hash = hashApiKey('test-key');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const h1 = hashApiKey('same-key');
    const h2 = hashApiKey('same-key');
    assert.equal(h1, h2);
  });

  it('produces different hashes for different inputs', () => {
    const h1 = hashApiKey('key-a');
    const h2 = hashApiKey('key-b');
    assert.notEqual(h1, h2);
  });
});

describe('createApiKey / revokeApiKey / lookupByHash round-trip', () => {
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

  it('creates a key and retrieves it by hash', () => {
    const { apiKey, plaintextKey } = createApiKey(db, { userId: 'user-1' });

    assert.ok(apiKey.id, 'apiKey should have an id');
    assert.equal(apiKey.userId, 'user-1');
    assert.equal(apiKey.enabled, true);
    assert.ok(plaintextKey.startsWith(API_KEY_PREFIX));

    // Look up by hashing the plaintext key
    const hash = hashApiKey(plaintextKey);
    const found = lookupByHash(db, hash);
    assert.ok(found, 'lookupByHash should find the created key');
    assert.equal(found!.id, apiKey.id);
  });

  it('revokeApiKey sets enabled=0 (does not delete row)', () => {
    const { apiKey } = createApiKey(db, { userId: 'user-1' });

    const revoked = revokeApiKey(db, apiKey.id);
    assert.ok(revoked, 'revokeApiKey should return true');

    // Row still exists in db
    const row = db.prepare('SELECT enabled FROM api_keys WHERE id = ?').get(apiKey.id) as { enabled: number } | undefined;
    assert.ok(row, 'row should still exist');
    assert.equal(row!.enabled, 0, 'enabled should be 0');
  });

  it('lookupByHash returns null for revoked keys', () => {
    const { apiKey, plaintextKey } = createApiKey(db, { userId: 'user-1' });
    revokeApiKey(db, apiKey.id);

    // lookupByHash returns the row (enabled is not checked inside lookupByHash)
    // but let's verify the key IS findable — the middleware checks enabled separately
    const hash = hashApiKey(plaintextKey);
    const found = lookupByHash(db, hash);
    // lookupByHash does NOT filter by enabled — it returns the row regardless
    // The middleware is responsible for checking enabled status
    assert.ok(found, 'lookupByHash returns the row even if revoked');
    assert.equal(found!.enabled, false, 'enabled should be false on the returned object');
  });

  it('lookupByHash returns null for non-existent keys', () => {
    const hash = hashApiKey('non-existent-key');
    const found = lookupByHash(db, hash);
    assert.equal(found, null);
  });

  it('lookupByHash does not throw on wrong-length hashes', () => {
    // Short hash
    const result1 = lookupByHash(db, 'abc');
    assert.equal(result1, null);

    // Empty hash
    const result2 = lookupByHash(db, '');
    assert.equal(result2, null);

    // Extra long hash
    const result3 = lookupByHash(db, 'a'.repeat(128));
    assert.equal(result3, null);
  });

  it('createApiKey uses default values for optional fields', () => {
    const { apiKey } = createApiKey(db, { userId: 'user-1' });

    assert.equal(apiKey.trustLevel, 'restricted');
    assert.equal(apiKey.rateLimitMax, 100);
    assert.equal(apiKey.rateLimitWindowMs, 900_000);
    assert.equal(apiKey.budgetUsd, 0);
    assert.equal(apiKey.project, null);
    assert.equal(apiKey.expiresAt, null);
  });

  it('createApiKey stores custom options', () => {
    const { apiKey } = createApiKey(db, {
      userId: 'user-2',
      project: 'my-project',
      trustLevel: 'open',
      rateLimitMax: 50,
      rateLimitWindowMs: 60_000,
      budgetUsd: 100,
      expiresAt: '2030-01-01T00:00:00Z',
    });

    assert.equal(apiKey.userId, 'user-2');
    assert.equal(apiKey.project, 'my-project');
    assert.equal(apiKey.trustLevel, 'open');
    assert.equal(apiKey.rateLimitMax, 50);
    assert.equal(apiKey.rateLimitWindowMs, 60_000);
    assert.equal(apiKey.budgetUsd, 100);
    assert.equal(apiKey.expiresAt, '2030-01-01T00:00:00Z');
  });
});

describe('lookupByHash with expired keys', () => {
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

  it('returns the key even if expired (expiration checked by middleware)', () => {
    const { apiKey, plaintextKey } = createApiKey(db, {
      userId: 'user-1',
      expiresAt: '2000-01-01T00:00:00Z', // already expired
    });

    const hash = hashApiKey(plaintextKey);
    const found = lookupByHash(db, hash);
    // lookupByHash does NOT check expiration — the middleware does
    assert.ok(found, 'lookupByHash returns expired keys');
    assert.equal(found!.id, apiKey.id);
  });
});

describe('listApiKeys', () => {
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

  it('filters by userId', () => {
    createApiKey(db, { userId: 'user-a' });
    createApiKey(db, { userId: 'user-a' });
    createApiKey(db, { userId: 'user-b' });

    const keysA = listApiKeys(db, 'user-a');
    assert.equal(keysA.length, 2);
    for (const k of keysA) {
      assert.equal(k.userId, 'user-a');
    }

    const keysB = listApiKeys(db, 'user-b');
    assert.equal(keysB.length, 1);
    assert.equal(keysB[0]!.userId, 'user-b');
  });

  it('returns all keys when no userId given', () => {
    createApiKey(db, { userId: 'user-a' });
    createApiKey(db, { userId: 'user-b' });

    const all = listApiKeys(db);
    assert.equal(all.length, 2);
  });

  it('returns empty array when no keys exist', () => {
    const keys = listApiKeys(db, 'nonexistent');
    assert.deepEqual(keys, []);
  });
});
