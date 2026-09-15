import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CostTracker } from '../../src/core/cost-tracker.js';
import {
  createStreamingRecordResult,
  recordUsage,
} from '../../src/core/router-telemetry.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'router-telemetry-test-'));
  return join(dir, 'test.db');
}

function assertSafeTelemetryFailure(error: unknown, canaries: readonly string[]): boolean {
  const message = error instanceof Error ? error.message : String(error);
  for (const canary of canaries) {
    assert.ok(!message.includes(canary), 'The rejection must not forward protected content');
  }
  return true;
}

describe('router-telemetry', () => {
  it('rejects protected-content and provider-error canaries before telemetry side effects', () => {
    const analyticsRecords: Array<Record<string, unknown>> = [];
    const costRecords: Array<Record<string, unknown>> = [];
    const canaries = [
      'WU1-PLAIN-CANARY', 'WU1-NESTED-CANARY', 'WU1-RENAMED-CANARY',
      'V1UxLUJBU0U2NC1DQU5BUlk=', 'WU1-ESCAPED-\\u0063ANARY', 'WU1-UNICODE-秘密',
      `${'x'.repeat(9_990)}WU1-TRUNCATION-CANARY`,
    ];
    const input = {
      provider: 'provider', model: 'model', latencyMs: 1, success: false,
      errorMessage: `provider failure: ${canaries[0]}`,
      context: { nested: canaries[1], prompt_alias: canaries[2], encoded: canaries[3] },
      escaped: canaries[4], unicode: canaries[5], boundary: canaries[6],
    } as unknown as Parameters<typeof recordUsage>[1];

    assert.throws(
      () => recordUsage({
        analyticsAggregator: { record: (_provider: string, _model: string, usage: Record<string, unknown>) => analyticsRecords.push(usage) } as never,
        costTracker: { record: (usage: Record<string, unknown>) => costRecords.push(usage) } as never,
        modelRouter: null,
      }, input),
      (error: unknown) => assertSafeTelemetryFailure(error, canaries),
    );
    assert.deepEqual(analyticsRecords, [], 'Rejected input must not reach analytics');
    assert.deepEqual(costRecords, [], 'Rejected input must not reach cost telemetry');
  });

  it('persists total-only usage without fabricating token splits', () => {
    const analyticsRecords: Array<Record<string, unknown>> = [];
    const costRecords: Array<Record<string, unknown>> = [];

    recordUsage(
      {
        analyticsAggregator: {
          record: (_provider: string, _model: string, usage: Record<string, unknown>) => {
            analyticsRecords.push(usage);
          },
        } as never,
        costTracker: {
          record: (usage: Record<string, unknown>) => {
            costRecords.push(usage);
          },
        } as never,
        modelRouter: null,
      },
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        totalTokens: 9,
        latencyMs: 25,
        success: true,
        apiKeyId: 'key-123',
        userId: 'user-123',
      },
    );

    assert.deepEqual(analyticsRecords, [
      {
        totalTokens: 9,
        inputTokens: undefined,
        outputTokens: undefined,
        cost: undefined,
        latencyMs: 25,
        success: true,
        attempt: undefined,
        channel: 'default',
      },
    ]);
    assert.deepEqual(costRecords, [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokensIn: undefined,
        tokensOut: undefined,
        totalTokens: 9,
        costUsd: undefined,
        latencyMs: 25,
        success: true,
        project: undefined,
        keyName: 'key-123',
        userId: 'user-123',
      },
    ]);
  });

  it('durably stores total-only usage rows through CostTracker', () => {
    const dbPath = tempDbPath();
    const tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    try {
      recordUsage(
        {
          analyticsAggregator: null,
          costTracker: tracker,
          modelRouter: null,
        },
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          totalTokens: 13,
          latencyMs: 40,
          success: true,
          apiKeyId: 'key-789',
          userId: 'user-789',
        },
      );

      tracker.flush();

      const records = tracker.query({ provider: 'openai' });
      assert.equal(records.length, 1);
      assert.equal(records[0]?.tokensIn, null);
      assert.equal(records[0]?.tokensOut, null);
      assert.equal(records[0]?.totalTokens, 13);
      assert.equal(records[0]?.costUsd, null);
      assert.equal(records[0]?.keyName, null);
      assert.equal(records[0]?.userId, null);
    } finally {
      tracker.destroy();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
  });

  it('preserves anonymous defaults when identity is unavailable', () => {
    const dbPath = tempDbPath();
    const tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    try {
      recordUsage(
        {
          analyticsAggregator: null,
          costTracker: tracker,
          modelRouter: null,
        },
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          totalTokens: 7,
          latencyMs: 12,
          success: true,
        },
      );

      tracker.flush();

      const records = tracker.query({ provider: 'openai' });
      assert.equal(records.length, 1);
      assert.equal(records[0]?.keyName, null);
      assert.equal(records[0]?.userId, null);
    } finally {
      tracker.destroy();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
  });

  it('persists unknown streaming usage as a single truthful row', () => {
    const dbPath = tempDbPath();
    const tracker = new CostTracker({ dbPath, flushIntervalMs: 60_000 });

    try {
      const recordStreamingResult = createStreamingRecordResult({
        telemetry: {
          analyticsAggregator: null,
          costTracker: tracker,
          modelRouter: null,
        },
        provider: {
          id: 'openai',
        } as never,
      });

      recordStreamingResult({
        model: 'gpt-4o-mini',
        latencyMs: 18,
        success: true,
        project: 'stream-project',
        apiKeyId: 'key-stream',
        userId: 'user-stream',
      });

      tracker.flush();

      const records = tracker.query({ provider: 'openai' });
      assert.equal(records.length, 1);
      assert.equal(records[0]?.model, 'gpt-4o-mini');
      assert.equal(records[0]?.project, null);
      assert.equal(records[0]?.keyName, null);
      assert.equal(records[0]?.userId, null);
      assert.equal(records[0]?.tokensIn, null);
      assert.equal(records[0]?.tokensOut, null);
      assert.equal(records[0]?.totalTokens, null);
      assert.equal(records[0]?.costUsd, null);
    } finally {
      tracker.destroy();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
  });
});
