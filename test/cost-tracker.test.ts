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
    assert.equal(summary.totalTokens, 900);
    assert.equal(summary.totalCostUsd, 3.50);
  });

  it('persists total-only usage with unknown cost', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 1.25,
      latencyMs: 200,
      success: true,
    });
    tracker.record({
      provider: 'legacy-provider',
      model: 'legacy-model',
      totalTokens: 9,
      latencyMs: 25,
      success: true,
    });

    tracker.flush();

    const records = tracker.query();
    assert.equal(records.length, 2);

    const totalOnlyRecord = records.find((record) => record.provider === 'legacy-provider');
    assert.ok(totalOnlyRecord);
    assert.equal(totalOnlyRecord.tokensIn, null);
    assert.equal(totalOnlyRecord.tokensOut, null);
    assert.equal(totalOnlyRecord.totalTokens, 9);
    assert.equal(totalOnlyRecord.costUsd, null);

    const summary = tracker.summary();
    assert.equal(summary.totalRequests, 2);
    assert.equal(summary.totalTokensIn, 100);
    assert.equal(summary.totalTokensOut, 50);
    assert.equal(summary.totalTokens, 159);
    assert.equal(summary.totalCostUsd, null);
    assert.equal(summary.knownCostUsd, 1.25);
    assert.equal(summary.unknownCostRequestCount, 1);
    assert.equal(summary.hasUnknownCost, true);

    const providerBreakdown = tracker.summary({ groupBy: 'provider' }).breakdown;
    const legacy = providerBreakdown.find((entry) => entry.key === 'legacy-provider');
    assert.ok(legacy);
    assert.equal(legacy.tokensIn, 0);
    assert.equal(legacy.tokensOut, 0);
    assert.equal(legacy.totalTokens, 9);
    assert.equal(legacy.costUsd, null);
    assert.equal(legacy.knownCostUsd, 0);
    assert.equal(legacy.unknownCostRequestCount, 1);
    assert.equal(legacy.hasUnknownCost, true);
  });

  it('keeps exact known-cost summaries unchanged when all rows are known', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({ provider: 'openai', model: 'gpt-4o', tokensIn: 100, tokensOut: 50, costUsd: 1.00, latencyMs: 200, success: true });
    tracker.record({ provider: 'anthropic', model: 'claude-3-haiku', tokensIn: 300, tokensOut: 150, costUsd: 0.50, latencyMs: 100, success: true });

    tracker.flush();

    const summary = tracker.summary({ groupBy: 'provider' });
    assert.equal(summary.totalCostUsd, 1.50);
    assert.equal(summary.knownCostUsd, 1.50);
    assert.equal(summary.unknownCostRequestCount, 0);
    assert.equal(summary.hasUnknownCost, false);

    const openai = summary.breakdown.find((entry) => entry.key === 'openai');
    assert.ok(openai);
    assert.equal(openai.costUsd, 1.00);
    assert.equal(openai.knownCostUsd, 1.00);
    assert.equal(openai.unknownCostRequestCount, 0);
    assert.equal(openai.hasUnknownCost, false);
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

  it('admission snapshot includes buffered usage before flush', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    tracker.record({
      provider: 'openai',
      apiKeyId: 'key-1',
      userId: 'user-1',
      model: 'gpt-4o',
      tokensIn: 10,
      tokensOut: 20,
      costUsd: 7,
      latencyMs: 50,
      success: true,
    });

    const snapshot = tracker.admissionSnapshot({
      identity: { userId: 'user-1', apiKeyId: 'key-1' },
      scope: 'budget',
    });

    assert.equal(snapshot.totalRequests, 1);
    assert.equal(snapshot.totalCostUsd, 7);
    assert.equal(snapshot.knownCostUsd, 7);
  });

  it('admission snapshot includes in-flight stream usage and removes it after finish', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    const recorder = tracker.recordStream('openai', 'gpt-4o', 'test-project', {
      userId: 'user-1',
      apiKeyId: 'key-1',
    });
    recorder.addChunk({ tokensIn: 10, tokensOut: 20 }, 0);

    const activeSnapshot = tracker.admissionSnapshot({
      identity: { userId: 'user-1', apiKeyId: 'key-1' },
      scope: 'budget',
    });
    assert.equal(activeSnapshot.totalRequests, 1);
    assert.ok(Math.abs((activeSnapshot.totalCostUsd ?? 0) - 0.000225) < 1e-12);

    recorder.finish();

    const finalizedSnapshot = tracker.admissionSnapshot({
      identity: { userId: 'user-1', apiKeyId: 'key-1' },
      scope: 'budget',
    });
    assert.equal(finalizedSnapshot.totalRequests, 1);
    assert.ok(Math.abs((finalizedSnapshot.totalCostUsd ?? 0) - 0.000225) < 1e-12);
  });

  it('admission snapshot does not invent spend for unknown-cost streaming usage', () => {
    dbPath = tempDbPath();
    tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    const recorder = tracker.recordStream('anthropic', 'claude-3', 'test-project', {
      userId: 'user-1',
      apiKeyId: 'key-1',
    });
    recorder.addChunk({ tokensOut: 20 }, 0);

    const snapshot = tracker.admissionSnapshot({
      identity: { userId: 'user-1', apiKeyId: 'key-1' },
      scope: 'budget',
    });

    assert.equal(snapshot.totalRequests, 1);
    assert.equal(snapshot.totalCostUsd, null);
    assert.equal(snapshot.knownCostUsd, 0);
    assert.equal(snapshot.unknownCostRequestCount, 1);
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
