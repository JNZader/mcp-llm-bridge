import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CostTracker } from '../../src/core/cost-tracker.js';
import { recordUsage } from '../../src/core/router-telemetry.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'router-telemetry-test-'));
  return join(dir, 'test.db');
}

describe('router-telemetry', () => {
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
        provider: 'legacy-provider',
        model: 'gpt-4o-mini',
        totalTokens: 9,
        latencyMs: 25,
        success: true,
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
        provider: 'legacy-provider',
        model: 'gpt-4o-mini',
        tokensIn: undefined,
        tokensOut: undefined,
        totalTokens: 9,
        costUsd: undefined,
        latencyMs: 25,
        success: true,
        project: undefined,
        errorMessage: undefined,
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
          provider: 'legacy-provider',
          model: 'legacy-model',
          totalTokens: 13,
          latencyMs: 40,
          success: true,
        },
      );

      tracker.flush();

      const records = tracker.query({ provider: 'legacy-provider' });
      assert.equal(records.length, 1);
      assert.equal(records[0]?.tokensIn, null);
      assert.equal(records[0]?.tokensOut, null);
      assert.equal(records[0]?.totalTokens, 13);
      assert.equal(records[0]?.costUsd, 0);
    } finally {
      tracker.destroy();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
  });
});
