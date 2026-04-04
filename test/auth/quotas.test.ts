/**
 * Tests for quota enforcement — rate limiting and budget checks.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';

import { checkRateLimit } from '../../src/auth/quotas.js';
import { initializeDb } from '../../src/vault/schema.js';
import { CostTracker } from '../../src/core/cost-tracker.js';

function createTestDb(): { db: Database.Database; path: string } {
  const path = join(tmpdir(), `mlb-test-${randomUUID()}.db`);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  initializeDb(db);
  return { db, path };
}

describe('checkRateLimit', () => {
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

  it('allows requests within limit', () => {
    const result = checkRateLimit(db, 'key-1', { max: 10, windowMs: 60_000 });
    assert.equal(result.allowed, true);
    assert.equal(result.retryAfter, undefined);
  });

  it('allows requests up to max - 1', () => {
    // Insert 9 usage_logs entries for key-1
    const stmt = db.prepare(
      `INSERT INTO usage_logs (provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, created_at)
       VALUES ('test', ?, 'model', '_global', 0, 0, 0, 0, 1, datetime('now'))`,
    );
    for (let i = 0; i < 9; i++) {
      stmt.run('key-1');
    }

    const result = checkRateLimit(db, 'key-1', { max: 10, windowMs: 60_000 });
    assert.equal(result.allowed, true);
  });

  it('rejects when at max with retryAfter', () => {
    // Insert 10 entries to hit max=10
    const stmt = db.prepare(
      `INSERT INTO usage_logs (provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, created_at)
       VALUES ('test', ?, 'model', '_global', 0, 0, 0, 0, 1, datetime('now'))`,
    );
    for (let i = 0; i < 10; i++) {
      stmt.run('key-1');
    }

    const result = checkRateLimit(db, 'key-1', { max: 10, windowMs: 60_000 });
    assert.equal(result.allowed, false);
    assert.ok(typeof result.retryAfter === 'number', 'retryAfter should be a number');
    assert.ok(result.retryAfter! >= 0, 'retryAfter should be non-negative');
  });

  it('does not count entries from other keys', () => {
    const stmt = db.prepare(
      `INSERT INTO usage_logs (provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, created_at)
       VALUES ('test', ?, 'model', '_global', 0, 0, 0, 0, 1, datetime('now'))`,
    );
    for (let i = 0; i < 10; i++) {
      stmt.run('other-key');
    }

    const result = checkRateLimit(db, 'key-1', { max: 10, windowMs: 60_000 });
    assert.equal(result.allowed, true);
  });

  it('does not count entries outside the window', () => {
    // Insert entries with created_at 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const stmt = db.prepare(
      `INSERT INTO usage_logs (provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, created_at)
       VALUES ('test', ?, 'model', '_global', 0, 0, 0, 0, 1, ?)`,
    );
    for (let i = 0; i < 10; i++) {
      stmt.run('key-1', twoHoursAgo);
    }

    // Window is 60s, so those entries should not count
    const result = checkRateLimit(db, 'key-1', { max: 10, windowMs: 60_000 });
    assert.equal(result.allowed, true);
  });
});

describe('checkBudget (via CostTracker)', () => {
  let costTracker: CostTracker;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `mlb-test-${randomUUID()}.db`);
    costTracker = new CostTracker({ dbPath, flushIntervalMs: 999_999 });
  });

  afterEach(() => {
    costTracker.destroy();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('allows within budget', () => {
    const result = costTracker.checkBudget('user-1', 100);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 100);
  });

  it('allows unlimited budget (budgetUsd=0)', () => {
    const result = costTracker.checkBudget('user-1', 0);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, Infinity);
  });

  it('rejects over budget with remaining=0', () => {
    // Record usage that exceeds the budget
    costTracker.record({
      provider: 'test',
      keyName: 'user-1',
      model: 'test-model',
      tokensIn: 1000,
      tokensOut: 1000,
      costUsd: 50,
      latencyMs: 100,
      success: true,
    });
    costTracker.flush();

    costTracker.record({
      provider: 'test',
      keyName: 'user-1',
      model: 'test-model',
      tokensIn: 1000,
      tokensOut: 1000,
      costUsd: 60,
      latencyMs: 100,
      success: true,
    });
    costTracker.flush();

    // Total cost = 110, budget = 100
    const result = costTracker.checkBudget('user-1', 100);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
  });

  it('budget warning at 80% — remaining < 20% of budget', () => {
    // Record usage of $85 against $100 budget → remaining is $15 which is < 20% ($20)
    costTracker.record({
      provider: 'test',
      keyName: 'user-1',
      model: 'test-model',
      tokensIn: 1000,
      tokensOut: 1000,
      costUsd: 85,
      latencyMs: 100,
      success: true,
    });
    costTracker.flush();

    const result = costTracker.checkBudget('user-1', 100);
    assert.equal(result.allowed, true);
    assert.ok(result.remaining < 100 * 0.2, 'remaining should be less than 20% of budget');
    assert.equal(result.remaining, 15);
  });

  it('does not count usage from other users', () => {
    costTracker.record({
      provider: 'test',
      keyName: 'other-user',
      model: 'test-model',
      tokensIn: 1000,
      tokensOut: 1000,
      costUsd: 200,
      latencyMs: 100,
      success: true,
    });
    costTracker.flush();

    const result = costTracker.checkBudget('user-1', 100);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 100);
  });
});
