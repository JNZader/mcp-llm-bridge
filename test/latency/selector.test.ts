/**
 * Latency selector tests — Router integration and selection logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectProviderWithLatency,
  measurementsToMap,
  buildLatencyMap,
  hasLatencyData,
  getLatencyStats,
  SIMILAR_LATENCY_THRESHOLD,
} from '../../src/latency/selector.js';
import type { LatencyMeasurement, ProviderCandidate } from '../../src/latency/types.js';

describe('selectProviderWithLatency', () => {
  it('should throw when no candidates provided', () => {
    assert.throws(
      () => selectProviderWithLatency([], new Map(), 0),
      /No provider candidates available/
    );
  });

  it('should return single candidate when only one provided', () => {
    const candidates: ProviderCandidate[] = [{ provider: 'openai' }];
    const latencyMap = new Map<string, number>();

    const result = selectProviderWithLatency(candidates, latencyMap);

    assert.equal(result.provider, 'openai');
  });

  it('should prefer fastest provider when latencies differ significantly', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'openai' },
      { provider: 'anthropic' },
      { provider: 'groq' },
    ];
    const latencyMap = new Map<string, number>([
      ['openai', 100],    // Fastest
      ['anthropic', 200], // 100% slower → above 20% threshold
      ['groq', 150],
    ]);

    const result = selectProviderWithLatency(candidates, latencyMap);

    assert.equal(result.provider, 'openai');
  });

  it('should use round robin when latencies are similar (within 20%)', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'openai' },
      { provider: 'anthropic' },
    ];
    // 105 vs 100 = 5% difference (within 20% threshold)
    const latencyMap = new Map<string, number>([
      ['openai', 100],
      ['anthropic', 105],
    ]);

    const result0 = selectProviderWithLatency(candidates, latencyMap, 0);
    const providers = candidates.map((c) => c.provider);
    assert.ok(providers.includes(result0.provider));

    // Second selection with roundRobinIndex 1
    const result1 = selectProviderWithLatency(candidates, latencyMap, 1);
    assert.ok(providers.includes(result1.provider));
  });

  it('should use fastest when second is more than 20% slower', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'fast' },
      { provider: 'slow' },
    ];
    // 121 vs 100 = 21% difference (above 20% threshold)
    const latencyMap = new Map<string, number>([
      ['fast', 100],
      ['slow', 121],
    ]);

    const result = selectProviderWithLatency(candidates, latencyMap);

    assert.equal(result.provider, 'fast');
  });

  it('should fall back to round robin when no latency data', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'openai' },
      { provider: 'anthropic' },
    ];
    const latencyMap = new Map<string, number>();

    const result0 = selectProviderWithLatency(candidates, latencyMap, 0);
    assert.equal(result0.provider, 'openai');

    const result1 = selectProviderWithLatency(candidates, latencyMap, 1);
    assert.equal(result1.provider, 'anthropic');

    const result2 = selectProviderWithLatency(candidates, latencyMap, 2);
    assert.equal(result2.provider, 'openai');
  });

  it('should use latency data provider over unknown providers', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'openai' },
      { provider: 'unknown' },
    ];
    const latencyMap = new Map<string, number>([['openai', 100]]);

    const result = selectProviderWithLatency(candidates, latencyMap);

    assert.equal(result.provider, 'openai');
  });

  it('should ignore failed measurements (latency <= 0)', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'openai' },
      { provider: 'failed' },
    ];
    const latencyMap = new Map<string, number>([
      ['openai', 100],
      ['failed', -1], // Failed measurement
    ]);

    const result = selectProviderWithLatency(candidates, latencyMap);

    assert.equal(result.provider, 'openai');
  });

  it('should handle single candidate with latency data', () => {
    const candidates: ProviderCandidate[] = [{ provider: 'openai' }];
    const latencyMap = new Map<string, number>([['openai', 100]]);

    const result = selectProviderWithLatency(candidates, latencyMap);

    assert.equal(result.provider, 'openai');
  });

  it('should use only candidates with latency data for round robin when some have data', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'has-data-1' },
      { provider: 'has-data-2' },
      { provider: 'no-data' },
    ];
    // All have similar latencies (within 20%)
    const latencyMap = new Map<string, number>([
      ['has-data-1', 100],
      ['has-data-2', 110], // 10% difference
      // 'no-data' has no latency
    ]);

    // With similar latencies, round robin should only use providers with data
    const result = selectProviderWithLatency(candidates, latencyMap, 0);
    assert.ok(result.provider === 'has-data-1' || result.provider === 'has-data-2');
  });
});

describe('measurementsToMap', () => {
  it('should convert measurements to latency map', () => {
    const now = Date.now();
    const measurements: LatencyMeasurement[] = [
      { provider: 'openai', url: 'https://api.openai.com', latencyMs: 100, measuredAt: now },
      { provider: 'anthropic', url: 'https://api.anthropic.com', latencyMs: 200, measuredAt: now },
    ];

    const map = measurementsToMap(measurements);

    assert.equal(map.get('openai'), 100);
    assert.equal(map.get('anthropic'), 200);
  });

  it('should exclude failed measurements (latency <= 0)', () => {
    const now = Date.now();
    const measurements: LatencyMeasurement[] = [
      { provider: 'openai', url: 'https://api.openai.com', latencyMs: 100, measuredAt: now },
      { provider: 'failed', url: 'https://failed.com', latencyMs: -1, measuredAt: now },
      { provider: 'zero', url: 'https://zero.com', latencyMs: 0, measuredAt: now },
    ];

    const map = measurementsToMap(measurements);

    assert.equal(map.get('openai'), 100);
    assert.equal(map.has('failed'), false);
    assert.equal(map.has('zero'), false);
  });

  it('should return empty map for empty array', () => {
    const map = measurementsToMap([]);
    assert.equal(map.size, 0);
  });
});

describe('buildLatencyMap', () => {
  it('should be an alias for measurementsToMap', () => {
    const now = Date.now();
    const measurements: LatencyMeasurement[] = [
      { provider: 'openai', url: 'https://api.openai.com', latencyMs: 100, measuredAt: now },
    ];

    const map = buildLatencyMap(measurements);

    assert.equal(map.get('openai'), 100);
  });
});

describe('hasLatencyData', () => {
  it('should return true when at least one candidate has latency data', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'openai' },
      { provider: 'unknown' },
    ];
    const latencyMap = new Map<string, number>([['openai', 100]]);

    assert.equal(hasLatencyData(candidates, latencyMap), true);
  });

  it('should return false when no candidates have latency data', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'openai' },
      { provider: 'anthropic' },
    ];
    const latencyMap = new Map<string, number>();

    assert.equal(hasLatencyData(candidates, latencyMap), false);
  });

  it('should return false when all measurements failed', () => {
    const candidates: ProviderCandidate[] = [{ provider: 'failed' }];
    const latencyMap = new Map<string, number>([['failed', -1]]);

    assert.equal(hasLatencyData(candidates, latencyMap), false);
  });

  it('should return false for empty candidates', () => {
    const latencyMap = new Map<string, number>([['openai', 100]]);

    assert.equal(hasLatencyData([], latencyMap), false);
  });
});

describe('getLatencyStats', () => {
  it('should calculate min, max, and average', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'a' },
      { provider: 'b' },
      { provider: 'c' },
    ];
    const latencyMap = new Map<string, number>([
      ['a', 100],
      ['b', 200],
      ['c', 300],
    ]);

    const stats = getLatencyStats(candidates, latencyMap);

    assert.deepEqual(stats, {
      min: 100,
      max: 300,
      avg: 200,
    });
  });

  it('should return null when no latency data', () => {
    const candidates: ProviderCandidate[] = [{ provider: 'unknown' }];
    const latencyMap = new Map<string, number>();

    const stats = getLatencyStats(candidates, latencyMap);

    assert.equal(stats, null);
  });

  it('should skip failed measurements in calculations', () => {
    const candidates: ProviderCandidate[] = [
      { provider: 'good' },
      { provider: 'failed' },
    ];
    const latencyMap = new Map<string, number>([
      ['good', 100],
      ['failed', -1],
    ]);

    const stats = getLatencyStats(candidates, latencyMap);

    assert.deepEqual(stats, {
      min: 100,
      max: 100,
      avg: 100,
    });
  });

  it('should handle single measurement', () => {
    const candidates: ProviderCandidate[] = [{ provider: 'only' }];
    const latencyMap = new Map<string, number>([['only', 150]]);

    const stats = getLatencyStats(candidates, latencyMap);

    assert.deepEqual(stats, {
      min: 150,
      max: 150,
      avg: 150,
    });
  });
});

describe('SIMILAR_LATENCY_THRESHOLD', () => {
  it('should be 0.2 (20%)', () => {
    assert.equal(SIMILAR_LATENCY_THRESHOLD, 0.2);
  });
});
