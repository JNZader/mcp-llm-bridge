import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { recordUsage } from '../../src/core/router-telemetry.js';

describe('router-telemetry', () => {
  it('does not fabricate token splits when only total usage is known', () => {
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
    assert.deepEqual(costRecords, []);
  });
});
