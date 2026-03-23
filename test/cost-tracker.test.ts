/**
 * CostTracker tests — record, buffer, flush, query, summary, destroy.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CostTracker } from '../src/core/cost-tracker.js';

/** Create a temp dir and return a db path inside it. */
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cost-tracker-test-'));
  return join(dir, 'test.db');
}

describe('CostTracker', () => {
  let tracker: CostTracker;
  let dbPath: string;

  afterEach(() => {
    if (tracker) {
      try { tracker.destroy(); } catch { /* already destroyed */ }
    }
    if (dbPath) {
      try { rmSync(dbPath, { force: true }); } catch { /* ok */ }
      try { rmSync(dbPath + '-wal', { force: true }); } catch { /* ok */ }
      try { rmSync(dbPath + '-shm', { force: true }); } catch { /* ok */ }
    }
  });

  it('records entries into in-memory buffer', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 }); // long interval to prevent auto-flush

    tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: 100,
      tokensOut: 50,
      latencyMs: 200,
      success: true,
    });

    assert.equal(tracker.bufferSize, 1);
  });

  it('flush writes buffer to SQLite', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: 100,
      tokensOut: 50,
      latencyMs: 200,
      success: true,
    });
    tracker.record({
      provider: 'anthropic',
      model: 'claude-3.5-sonnet',
      tokensIn: 200,
      tokensOut: 100,
      latencyMs: 300,
      success: true,
    });

    assert.equal(tracker.bufferSize, 2);

    tracker.flush();

    assert.equal(tracker.bufferSize, 0);

    // Verify records are in DB
    const records = tracker.query();
    assert.equal(records.length, 2);
  });

  it('auto-calculates cost when not provided', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      latencyMs: 500,
      success: true,
    });

    tracker.flush();

    const records = tracker.query();
    assert.equal(records.length, 1);
    const record = records[0]!;
    // gpt-4o: $2.50 input + $10.00 output = $12.50
    assert.equal(record.costUsd, 12.50);
  });

  it('respects explicit cost override', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 99.99,
      latencyMs: 200,
      success: true,
    });

    tracker.flush();

    const records = tracker.query();
    assert.equal(records[0]!.costUsd, 99.99);
  });

  it('queries with provider filter', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, latencyMs: 200, success: true });
    tracker.record({ provider: 'anthropic', model: 'claude-3-haiku', tokensIn: 100, tokensOut: 50, latencyMs: 200, success: true });
    tracker.record({ provider: 'openai', model: 'gpt-4o-mini', tokensIn: 100, tokensOut: 50, latencyMs: 200, success: true });

    tracker.flush();

    const openaiRecords = tracker.query({ provider: 'openai' });
    assert.equal(openaiRecords.length, 2);

    const anthropicRecords = tracker.query({ provider: 'anthropic' });
    assert.equal(anthropicRecords.length, 1);
  });

  it('queries with model filter', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, latencyMs: 200, success: true });
    tracker.record({ provider: 'openai', model: 'gpt-4o-mini', tokensIn: 100, tokensOut: 50, latencyMs: 200, success: true });

    tracker.flush();

    const records = tracker.query({ model: 'gpt-4o' });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.model, 'gpt-4o');
  });

  it('records failed attempts', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 100,
      success: false,
      errorMessage: 'Rate limit exceeded',
    });

    tracker.flush();

    const records = tracker.query();
    assert.equal(records.length, 1);
    assert.equal(records[0]!.success, false);
    assert.equal(records[0]!.errorMessage, 'Rate limit exceeded');
  });

  it('summary returns correct totals', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, costUsd: 1.00, latencyMs: 200, success: true });
    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 200, tokensOut: 100, costUsd: 2.00, latencyMs: 400, success: true });
    tracker.record({ provider: 'anthropic', model: 'claude-3-haiku', tokensIn: 300, tokensOut: 150, costUsd: 0.50, latencyMs: 100, success: true });

    tracker.flush();

    const summary = tracker.summary();
    assert.equal(summary.totalRequests, 3);
    assert.equal(summary.totalTokensIn, 600);
    assert.equal(summary.totalTokensOut, 300);
    assert.equal(summary.totalCostUsd, 3.50);
  });

  it('summary with groupBy provider returns breakdown', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, costUsd: 1.00, latencyMs: 200, success: true });
    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 200, tokensOut: 100, costUsd: 2.00, latencyMs: 400, success: true });
    tracker.record({ provider: 'anthropic', model: 'claude-3-haiku', tokensIn: 300, tokensOut: 150, costUsd: 0.50, latencyMs: 100, success: true });

    tracker.flush();

    const summary = tracker.summary({ groupBy: 'provider' });
    assert.equal(summary.breakdown.length, 2);

    const openai = summary.breakdown.find((b) => b.key === 'openai');
    assert.ok(openai);
    assert.equal(openai.requests, 2);
    assert.equal(openai.costUsd, 3.00);

    const anthropic = summary.breakdown.find((b) => b.key === 'anthropic');
    assert.ok(anthropic);
    assert.equal(anthropic.requests, 1);
    assert.equal(anthropic.costUsd, 0.50);
  });

  it('summary with groupBy model returns breakdown', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, costUsd: 1.00, latencyMs: 200, success: true });
    tracker.record({ provider: 'openai', model: 'gpt-4o-mini', tokensIn: 200, tokensOut: 100, costUsd: 0.10, latencyMs: 100, success: true });

    tracker.flush();

    const summary = tracker.summary({ groupBy: 'model' });
    assert.equal(summary.breakdown.length, 2);
  });

  it('destroy flushes remaining buffer', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, latencyMs: 200, success: true });
    assert.equal(tracker.bufferSize, 1);

    // Destroy should flush
    tracker.destroy();

    // Create a new tracker to verify records were persisted
    const tracker2 = new CostTracker({ dbPath, flushIntervalMs: 60_000 });
    const records = tracker2.query();
    assert.equal(records.length, 1);
    tracker2.destroy();
  });

  it('query respects limit', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    for (let i = 0; i < 10; i++) {
      tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, latencyMs: 200, success: true });
    }
    tracker.flush();

    const records = tracker.query({ limit: 3 });
    assert.equal(records.length, 3);
  });

  it('query with date range filter', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, latencyMs: 200, success: true });
    tracker.flush();

    // Future date should return nothing
    const records = tracker.query({ from: '2099-01-01' });
    assert.equal(records.length, 0);

    // Past date should return records
    const allRecords = tracker.query({ from: '2020-01-01' });
    assert.equal(allRecords.length, 1);
  });

  it('stores keyName and project', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({
      provider: 'openai',
      keyName: 'key-1',
      model: 'gpt-4o',
      project: 'my-project',
      tokensIn: 100,
      tokensOut: 50,
      latencyMs: 200,
      success: true,
    });

    tracker.flush();

    const records = tracker.query({ project: 'my-project' });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.keyName, 'key-1');
    assert.equal(records[0]!.project, 'my-project');
  });
});
