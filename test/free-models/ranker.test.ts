/**
 * Free Model Ranker tests — scoring and ranking logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreLatency,
  scoreReliability,
  scoreCapability,
  computeScore,
  rankModels,
} from '../../src/free-models/ranker.js';
import { HealthChecker } from '../../src/free-models/health.js';
import type { FreeModelEntry } from '../../src/free-models/types.js';

// ── scoreLatency ──────────────────────────────────────────

describe('scoreLatency', () => {
  it('returns 100 for 0ms latency', () => {
    assert.equal(scoreLatency(0), 100);
  });

  it('returns 0 for null latency (unreachable)', () => {
    assert.equal(scoreLatency(null), 0);
  });

  it('returns 0 for negative latency', () => {
    assert.equal(scoreLatency(-100), 0);
  });

  it('returns 0 for latency >= 10000ms', () => {
    assert.equal(scoreLatency(10_000), 0);
    assert.equal(scoreLatency(15_000), 0);
  });

  it('returns ~50 for 5000ms latency', () => {
    const score = scoreLatency(5000);
    assert.ok(score >= 49 && score <= 51, `Expected ~50, got ${score}`);
  });

  it('scores decrease linearly with latency', () => {
    const score1000 = scoreLatency(1000);
    const score3000 = scoreLatency(3000);
    const score5000 = scoreLatency(5000);

    assert.ok(score1000 > score3000);
    assert.ok(score3000 > score5000);
  });
});

// ── scoreReliability ──────────────────────────────────────

describe('scoreReliability', () => {
  it('returns 100 for reliability 1.0', () => {
    assert.equal(scoreReliability(1.0), 100);
  });

  it('returns 0 for reliability 0.0', () => {
    assert.equal(scoreReliability(0.0), 0);
  });

  it('returns 50 for reliability 0.5', () => {
    assert.equal(scoreReliability(0.5), 50);
  });

  it('clamps values above 1.0', () => {
    assert.equal(scoreReliability(1.5), 100);
  });

  it('clamps negative values to 0', () => {
    assert.equal(scoreReliability(-0.5), 0);
  });
});

// ── scoreCapability ──────────────────────────────────────

describe('scoreCapability', () => {
  it('returns 100 when no capabilities required', () => {
    assert.equal(scoreCapability(['chat', 'code'], []), 100);
  });

  it('returns 100 when all required capabilities match', () => {
    assert.equal(scoreCapability(['chat', 'code'], ['chat', 'code']), 100);
  });

  it('returns 50 when half of required capabilities match', () => {
    assert.equal(scoreCapability(['chat'], ['chat', 'code']), 50);
  });

  it('returns 0 when no required capabilities match', () => {
    assert.equal(scoreCapability(['chat'], ['vision', 'embedding']), 0);
  });
});

// ── computeScore ──────────────────────────────────────────

describe('computeScore', () => {
  it('returns weighted combination of all three scores', () => {
    // Weights: latency=0.4, reliability=0.35, capability=0.25
    const score = computeScore(100, 100, 100);
    assert.equal(score, 100);
  });

  it('returns 0 when all scores are 0', () => {
    assert.equal(computeScore(0, 0, 0), 0);
  });

  it('weights latency highest', () => {
    const highLatency = computeScore(100, 0, 0);
    const highReliability = computeScore(0, 100, 0);
    const highCapability = computeScore(0, 0, 100);

    assert.ok(highLatency > highReliability);
    assert.ok(highReliability > highCapability);
  });
});

// ── rankModels ────────────────────────────────────────────

describe('rankModels', () => {
  function makeEntry(id: string, caps: FreeModelEntry['capabilities'] = ['chat']): FreeModelEntry {
    return {
      id,
      name: id,
      source: 'test',
      baseUrl: `https://${id}.test.com/v1`,
      modelId: `test/${id}`,
      capabilities: caps,
      maxTokens: 4096,
      enabled: true,
    };
  }

  it('returns empty array when no entries provided', () => {
    const checker = new HealthChecker();
    const ranked = rankModels([], checker);
    assert.equal(ranked.length, 0);
    checker.destroy();
  });

  it('includes unknown-health models with neutral score', () => {
    const checker = new HealthChecker();
    const entries = [makeEntry('model-a'), makeEntry('model-b')];

    const ranked = rankModels(entries, checker);
    assert.equal(ranked.length, 2);

    // Both should have scores (unknown models get neutral reliability)
    for (const r of ranked) {
      assert.ok(r.score >= 0);
    }
    checker.destroy();
  });

  it('sorts by score descending', () => {
    const checker = new HealthChecker();
    const entries = [makeEntry('model-a'), makeEntry('model-b'), makeEntry('model-c')];

    const ranked = rankModels(entries, checker);

    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i]!.score <= ranked[i - 1]!.score);
    }
    checker.destroy();
  });

  it('filters models with capability requirements', () => {
    const checker = new HealthChecker();
    const entries = [
      makeEntry('chat-only', ['chat']),
      makeEntry('code-model', ['chat', 'code']),
    ];

    const ranked = rankModels(entries, checker, ['code']);

    // code-model should score higher on capability
    const codeModel = ranked.find((r) => r.entry.id === 'code-model');
    const chatOnly = ranked.find((r) => r.entry.id === 'chat-only');

    assert.ok(codeModel);
    assert.ok(chatOnly);
    assert.ok(
      codeModel.breakdown.capabilityScore > chatOnly.breakdown.capabilityScore,
    );
    checker.destroy();
  });
});
