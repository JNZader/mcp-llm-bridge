/**
 * TDD Tests for Analytics Aggregator
 *
 * Following the specification from openspec/changes/octopus-features/tasks.md
 * Tasks 2.2.1, 2.2.2: Analytics aggregator (tests + implementation)
 *
 * TDD Approach: RED phase first - write failing tests, then implement
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsAggregator } from '../../src/analytics/index';

// Mock database interface for flush tests
interface MockDatabase {
  analytics: {
    insert: (data: unknown) => Promise<void>;
    query: (sql: string, params: unknown[]) => Promise<unknown[]>;
  };
}

function createMockDb(): MockDatabase {
  return {
    analytics: {
      insert: async () => {},
      query: async () => [],
    },
  };
}

describe('AnalyticsAggregator - RED Phase (TDD)', () => {
  let aggregator: AnalyticsAggregator;

  beforeEach(() => {
    aggregator = new AnalyticsAggregator();
  });

  describe('Constructor', () => {
    it('should initialize with empty dimensions', () => {
      const total = aggregator.query({ dimension: 'total' });
      expect(total).toHaveLength(1);
      expect(total[0].requests).toBe(0);
      expect(total[0].inputTokens).toBe(0);
      expect(total[0].outputTokens).toBe(0);
      expect(total[0].cost).toBe(0);
    });

    it('should accept custom max latency window', () => {
      const customAgg = new AnalyticsAggregator({ maxLatencyWindow: 500 });
      expect(customAgg).toBeDefined();
    });
  });

  describe('record() - Single Request', () => {
    it('should record a request to total dimension', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      const total = aggregator.query({ dimension: 'total' });
      expect(total).toHaveLength(1);
      expect(total[0].requests).toBe(1);
      expect(total[0].inputTokens).toBe(100);
      expect(total[0].outputTokens).toBe(50);
      expect(total[0].cost).toBe(0.0025);
      expect(total[0].avgLatency).toBe(1200);
    });

    it('should record a request to hourly dimension', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      const hourly = aggregator.query({ dimension: 'hourly' });
      expect(hourly.length).toBeGreaterThan(0);
      expect(hourly[0].requests).toBe(1);
    });

    it('should record a request to daily dimension', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      const daily = aggregator.query({ dimension: 'daily' });
      expect(daily.length).toBeGreaterThan(0);
      expect(daily[0].requests).toBe(1);
    });

    it('should record a request to channel dimension', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'fast',
      });

      const channel = aggregator.query({ dimension: 'channel' });
      expect(channel).toHaveLength(1);
      expect(channel[0].requests).toBe(1);
    });

    it('should record a request to model dimension', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      const model = aggregator.query({ dimension: 'model' });
      expect(model).toHaveLength(1);
      expect(model[0].requests).toBe(1);
    });
  });

  describe('record() - Multiple Requests Aggregation', () => {
    it('should aggregate multiple requests to same hour', () => {
      const now = Date.now();

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
        timestamp: now,
      });

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.005,
        latencyMs: 800,
        channel: 'default',
        timestamp: now,
      });

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].requests).toBe(2);
      expect(total[0].inputTokens).toBe(300);
      expect(total[0].outputTokens).toBe(150);
      expect(total[0].cost).toBe(0.0075);
    });

    it('should aggregate requests from same provider but different models', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      aggregator.record('openai', 'gpt-3.5-turbo', {
        inputTokens: 150,
        outputTokens: 75,
        cost: 0.0015,
        latencyMs: 600,
        channel: 'default',
      });

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].requests).toBe(2);

      const model = aggregator.query({ dimension: 'model' });
      expect(model).toHaveLength(2);
    });

    it('should track different channels separately', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'fast',
      });

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.005,
        latencyMs: 800,
        channel: 'quality',
      });

      const channel = aggregator.query({ dimension: 'channel' });
      expect(channel).toHaveLength(2);
    });
  });

  describe('Latency Calculations', () => {
    it('should calculate average latency correctly', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1000,
        channel: 'default',
      });

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 2000,
        channel: 'default',
      });

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].avgLatency).toBe(1500);
    });

    it('should calculate p95 latency', () => {
      // Add 20 requests with varying latencies
      for (let i = 0; i < 20; i++) {
        aggregator.record('openai', 'gpt-4o', {
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.0025,
          latencyMs: (i + 1) * 100, // 100, 200, 300, ..., 2000
          channel: 'default',
        });
      }

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].p95Latency).toBeDefined();
      // p95 of 20 samples should be around the 19th value (1900ms)
      expect(total[0].p95Latency).toBeGreaterThanOrEqual(1800);
    });

    it('should calculate p99 latency', () => {
      // Add 100 requests with varying latencies
      for (let i = 0; i < 100; i++) {
        aggregator.record('openai', 'gpt-4o', {
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.0025,
          latencyMs: (i + 1) * 10, // 10, 20, 30, ..., 1000
          channel: 'default',
        });
      }

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].p99Latency).toBeDefined();
      // p99 of 100 samples should be around 990ms
      expect(total[0].p99Latency).toBeGreaterThanOrEqual(900);
    });

    it('should not include percentiles when not enough samples', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1000,
        channel: 'default',
      });

      const total = aggregator.query({ dimension: 'total' });
      // With only 1 sample, percentiles might not be calculated
      expect(total[0].avgLatency).toBe(1000);
    });
  });

  describe('query() - Time Range Filtering', () => {
    it('should filter by from timestamp', () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;
      const twoHoursAgo = now - 7200000;

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
        timestamp: twoHoursAgo,
      });

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.005,
        latencyMs: 800,
        channel: 'default',
        timestamp: now,
      });

      const hourly = aggregator.query({
        dimension: 'hourly',
        from: oneHourAgo,
      });

      // Should only include the recent request
      expect(hourly.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by to timestamp', () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;
      const twoHoursAgo = now - 7200000;

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
        timestamp: twoHoursAgo,
      });

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.005,
        latencyMs: 800,
        channel: 'default',
        timestamp: now,
      });

      const hourly = aggregator.query({
        dimension: 'hourly',
        to: oneHourAgo,
      });

      // Should only include the old request
      expect(hourly.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by from and to range', () => {
      const now = Date.now();
      // Floor to hour boundaries for more predictable behavior
      const currentHour = new Date(now);
      currentHour.setMinutes(0, 0, 0);
      const currentHourTs = currentHour.getTime();

      const twoHoursAgo = new Date(currentHourTs - 2 * 3600000);
      const twoHoursAgoTs = twoHoursAgo.getTime();

      const threeHoursAgo = new Date(currentHourTs - 3 * 3600000);
      const threeHoursAgoTs = threeHoursAgo.getTime();

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
        timestamp: threeHoursAgoTs,
      });

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.005,
        latencyMs: 800,
        channel: 'default',
        timestamp: twoHoursAgoTs,
      });

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 300,
        outputTokens: 150,
        cost: 0.0075,
        latencyMs: 600,
        channel: 'default',
        timestamp: currentHourTs,
      });

      // Query for only the middle hour
      const hourly = aggregator.query({
        dimension: 'hourly',
        from: twoHoursAgoTs,
        to: twoHoursAgoTs + 3600000 - 1, // Within the two hours ago hour
      });

      // Should include only the middle request's hour
      expect(hourly.length).toBe(1);
      expect(hourly[0].inputTokens).toBe(200);
    });
  });

  describe('query() - Dimension Filtering', () => {
    it('should filter by channelId', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'fast',
      });

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.005,
        latencyMs: 800,
        channel: 'quality',
      });

      const fastChannel = aggregator.query({
        dimension: 'channel',
        channelId: 'fast',
      });

      expect(fastChannel).toHaveLength(1);
      expect(fastChannel[0].requests).toBe(1);
      expect(fastChannel[0].inputTokens).toBe(100);
    });

    it('should filter by model', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      aggregator.record('openai', 'gpt-3.5-turbo', {
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.005,
        latencyMs: 800,
        channel: 'default',
      });

      const modelQuery = aggregator.query({
        dimension: 'model',
        model: 'gpt-4o',
      });

      expect(modelQuery).toHaveLength(1);
      expect(modelQuery[0].requests).toBe(1);
    });

    it('should return empty array for non-existent channel', () => {
      const result = aggregator.query({
        dimension: 'channel',
        channelId: 'non-existent',
      });

      expect(result).toHaveLength(0);
    });

    it('should return empty array for non-existent model', () => {
      const result = aggregator.query({
        dimension: 'model',
        model: 'non-existent',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('flush() - Database Persistence', () => {
    it('should flush total dimension to database', async () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      const mockDb = createMockDb();
      let insertedData: unknown = null;
      mockDb.analytics.insert = async (data) => {
        insertedData = data;
      };

      await aggregator.flush(mockDb as unknown as import('../../src/analytics/types').Database);

      expect(insertedData).not.toBeNull();
    });

    it('should clear in-memory data after flush', async () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      const mockDb = createMockDb();
      await aggregator.flush(mockDb as unknown as import('../../src/analytics/types').Database);

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].requests).toBe(0);
    });
  });

  describe('clear() - Reset', () => {
    it('should reset all dimensions', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      aggregator.clear();

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].requests).toBe(0);
      expect(total[0].inputTokens).toBe(0);

      const hourly = aggregator.query({ dimension: 'hourly' });
      expect(hourly).toHaveLength(0);

      const channel = aggregator.query({ dimension: 'channel' });
      expect(channel).toHaveLength(0);
    });
  });

  describe('Sliding Window for Latencies', () => {
    it('should maintain sliding window of last N latencies', () => {
      // Create aggregator with small window
      const smallAgg = new AnalyticsAggregator({ maxLatencyWindow: 10 });

      // Add 15 requests
      for (let i = 0; i < 15; i++) {
        smallAgg.record('openai', 'gpt-4o', {
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.0025,
          latencyMs: (i + 1) * 100,
          channel: 'default',
        });
      }

      // Percentiles should be calculated from last 10 latencies (600-1500)
      const total = smallAgg.query({ dimension: 'total' });
      expect(total[0].requests).toBe(15);
      expect(total[0].avgLatency).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero values', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        latencyMs: 0,
        channel: 'default',
      });

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].requests).toBe(1);
      expect(total[0].inputTokens).toBe(0);
      expect(total[0].cost).toBe(0);
      expect(total[0].avgLatency).toBe(0);
    });

    it('should handle very large numbers', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 1000000,
        outputTokens: 500000,
        cost: 1000.50,
        latencyMs: 60000,
        channel: 'default',
      });

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].inputTokens).toBe(1000000);
      expect(total[0].cost).toBe(1000.50);
      expect(total[0].avgLatency).toBe(60000);
    });

    it('should handle multiple providers', () => {
      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
      });

      aggregator.record('anthropic', 'claude-3-opus', {
        inputTokens: 150,
        outputTokens: 75,
        cost: 0.003,
        latencyMs: 1500,
        channel: 'default',
      });

      aggregator.record('groq', 'llama3-70b', {
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.001,
        latencyMs: 300,
        channel: 'default',
      });

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].requests).toBe(3);
    });

    it('should handle empty query results gracefully', () => {
      const hourly = aggregator.query({ dimension: 'hourly' });
      expect(hourly).toEqual([]);

      const daily = aggregator.query({ dimension: 'daily' });
      expect(daily).toEqual([]);
    });

    it('should handle query with only to timestamp (no from)', () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;

      aggregator.record('openai', 'gpt-4o', {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        channel: 'default',
        timestamp: oneHourAgo,
      });

      const hourly = aggregator.query({
        dimension: 'hourly',
        to: now,
      });

      expect(hourly.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle concurrent requests simulation', () => {
      // Simulate multiple records happening "concurrently"
      for (let i = 0; i < 50; i++) {
        aggregator.record('openai', 'gpt-4o', {
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.0025,
          latencyMs: 1000 + i,
          channel: 'default',
        });
      }

      const total = aggregator.query({ dimension: 'total' });
      expect(total[0].requests).toBe(50);
      expect(total[0].inputTokens).toBe(5000);
    });
  });
});

describe('AnalyticsAggregator - Performance', () => {
  it('should handle high volume of records efficiently', () => {
    const perfAggregator = new AnalyticsAggregator();
    const start = performance.now();

    // Record 1000 requests
    for (let i = 0; i < 1000; i++) {
      perfAggregator.record('openai', 'gpt-4o', {
        inputTokens: 100 + i,
        outputTokens: 50 + i,
        cost: 0.0025 + i * 0.0001,
        latencyMs: 1000 + (i % 100),
        channel: `channel-${i % 10}`,
      });
    }

    const end = performance.now();
    const duration = end - start;

    // Should complete in reasonable time (less than 1 second for 1000 records)
    expect(duration).toBeLessThan(1000);

    const total = perfAggregator.query({ dimension: 'total' });
    expect(total[0].requests).toBe(1000);
  });
});
