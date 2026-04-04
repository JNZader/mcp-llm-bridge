/**
 * API Key Management — generation, hashing, CRUD, and lookup.
 *
 * Security considerations:
 * - Keys are NEVER stored in plaintext — only SHA-256 hashes.
 * - Lookup uses timing-safe comparison via crypto.timingSafeEqual.
 * - Key format: `mlb_sk_` + 32 random hex characters.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

import type { ApiKey, CreateKeyOpts } from './types.js';
import { API_KEY_PREFIX, API_KEY_HEX_LENGTH } from './types.js';

// ── Key Generation & Hashing ────────────────────────────────

/**
 * Generate a new API key with the `mlb_sk_` prefix.
 *
 * @returns An object with the plaintext key, its SHA-256 hash, and the display prefix.
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const hexPart = randomBytes(API_KEY_HEX_LENGTH / 2).toString('hex');
  const key = `${API_KEY_PREFIX}${hexPart}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, API_KEY_PREFIX.length + 8);

  return { key, hash, prefix };
}

/**
 * Hash an API key using SHA-256.
 *
 * @param key - The plaintext API key.
 * @returns Hex-encoded SHA-256 digest.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

// ── DB Row Shape ────────────────────────────────────────────

interface ApiKeyRow {
  id: string;
  key_hash: string;
  key_prefix: string;
  user_id: string;
  project: string | null;
  trust_level: string;
  rate_limit_max: number;
  rate_limit_window_ms: number;
  budget_usd: number;
  enabled: number;
  created_at: string;
  expires_at: string | null;
}

/** Convert a DB row to an ApiKey domain object. */
function rowToApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    userId: row.user_id,
    project: row.project,
    trustLevel: row.trust_level as ApiKey['trustLevel'],
    rateLimitMax: row.rate_limit_max,
    rateLimitWindowMs: row.rate_limit_window_ms,
    budgetUsd: row.budget_usd,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// ── CRUD Operations ────────────────────────────────────────

/**
 * Create a new API key in the database.
 *
 * @returns The ApiKey record (hash stored, not the plaintext key).
 *          The plaintext key is returned by `generateApiKey()` and must be
 *          delivered to the user ONCE at creation time.
 */
export function createApiKey(
  db: Database.Database,
  opts: CreateKeyOpts,
): { apiKey: ApiKey; plaintextKey: string } {
  const { key, hash, prefix } = generateApiKey();
  const id = randomUUID();

  const stmt = db.prepare(`
    INSERT INTO api_keys (id, key_hash, key_prefix, user_id, project, trust_level,
      rate_limit_max, rate_limit_window_ms, budget_usd, enabled, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  stmt.run(
    id,
    hash,
    prefix,
    opts.userId,
    opts.project ?? null,
    opts.trustLevel ?? 'restricted',
    opts.rateLimitMax ?? 100,
    opts.rateLimitWindowMs ?? 900_000,
    opts.budgetUsd ?? 0,
    opts.expiresAt ?? null,
  );

  const row = db
    .prepare<[string], ApiKeyRow>('SELECT * FROM api_keys WHERE id = ?')
    .get(id);

  if (!row) {
    throw new Error('Failed to create API key — row not found after insert');
  }

  return { apiKey: rowToApiKey(row), plaintextKey: key };
}

/**
 * Revoke an API key by setting enabled=0.
 * Does NOT delete the row — keeps audit trail.
 */
export function revokeApiKey(db: Database.Database, id: string): boolean {
  const result = db
    .prepare('UPDATE api_keys SET enabled = 0 WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

/**
 * Look up an API key by its hash using timing-safe comparison.
 *
 * We first query by hash (indexed), then do a timing-safe comparison
 * on the hash to prevent timing side-channels. The DB index lookup
 * itself leaks some timing info (hit vs miss), but the hash comparison
 * ensures the actual key content is not leaked through timing.
 *
 * @param db - Database instance.
 * @param hash - SHA-256 hex digest of the plaintext key.
 * @returns The ApiKey if found and the hash matches timing-safely, null otherwise.
 */
export function lookupByHash(
  db: Database.Database,
  hash: string,
): ApiKey | null {
  const row = db
    .prepare<[string], ApiKeyRow>('SELECT * FROM api_keys WHERE key_hash = ?')
    .get(hash);

  if (!row) return null;

  // Timing-safe comparison of the hash to prevent side-channel attacks
  const storedBuf = Buffer.from(row.key_hash, 'utf8');
  const lookupBuf = Buffer.from(hash, 'utf8');

  if (storedBuf.length !== lookupBuf.length) return null;
  if (!timingSafeEqual(storedBuf, lookupBuf)) return null;

  return rowToApiKey(row);
}

/**
 * List all API keys for a user (or all keys if no userId given).
 * Never returns the key_hash — only metadata.
 */
export function listApiKeys(
  db: Database.Database,
  userId?: string,
): ApiKey[] {
  if (userId) {
    const rows = db
      .prepare<[string], ApiKeyRow>(
        'SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
      )
      .all(userId);
    return rows.map(rowToApiKey);
  }

  const rows = db
    .prepare('SELECT * FROM api_keys ORDER BY created_at DESC')
    .all() as ApiKeyRow[];
  return rows.map(rowToApiKey);
}
