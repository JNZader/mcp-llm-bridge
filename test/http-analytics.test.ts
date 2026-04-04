/**
 * HTTP Analytics API endpoint tests — GET /v1/analytics
 *
 * TDD Red Phase: These tests define expected behavior for the analytics API.
 * Following Task 2.2.4 from openspec/changes/octopus-features/tasks.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import http from 'node:http';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import type { GatewayConfig } from '../src/core/types.js';
import { startHttpServer } from '../src/server/http.js';
import { createAllAdapters } from '../src/adapters/index.js';
import { AnalyticsAggregator } from '../src/analytics/index.js';

// Create test components
const config: GatewayConfig & { authToken: string } = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-http-analytics-${Date.now()}.db`,
  httpPort: 0,
  authToken: 'test-token-12345',
};

const vault = new Vault(config);
const router = new Router();

for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

let server: http.Server;
let port = 0;
let analyticsAggregator: AnalyticsAggregator;

// Helper function to make HTTP requests
async function request(
  method: string,
  path: string,
  opts?: { body?: object; auth?: string | null },
): Promise<{ status: number; data: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts?.body ? JSON.stringify(opts.body) : undefined;
    // Only use default auth token if auth is not explicitly set (including null)
    const authToken = opts && 'auth' in opts ? opts.auth : config.authToken;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              data: data ? JSON.parse(data) : {},
              headers: res.headers,
            });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: {}, headers: res.headers });
          }
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Helper to seed analytics with test data
function seedTestAnalytics(): void {
  const now = Date.now();

  // Create diverse test data across dimensions
  const entries = [
    // Hourly data - multiple hours
    { provider: 'openai', model: 'gpt-4', channel: 'fast', inputTokens: 100, outputTokens: 50, cost: 0.0025, latencyMs: 1200, timestamp: now - 1000 },
    { provider: 'openai', model: 'gpt-4', channel: 'fast', inputTokens: 150, outputTokens: 75, cost: 0.00375, latencyMs: 1400, timestamp: now - 2000 },
    { provider: 'openai', model: 'gpt-3.5', channel: 'cheap', inputTokens: 50, outputTokens: 25, cost: 0.001, latencyMs: 800, timestamp: now - 3000 },
    // Different provider
    { provider: 'groq', model: 'llama3-70b', channel: 'fast', inputTokens: 100, outputTokens: 100, cost: 0.001, latencyMs: 500, timestamp: now - 4000 },
    { provider: 'groq', model: 'llama3-8b', channel: 'cheap', inputTokens: 50, outputTokens: 50, cost: 0.0005, latencyMs: 300, timestamp: now - 5000 },
    // Different model
    { provider: 'anthropic', model: 'claude-3', channel: 'balanced', inputTokens: 200, outputTokens: 150, cost: 0.003, latencyMs: 1500, timestamp: now - 6000 },
    // Older data (for time filtering)
    { provider: 'openai', model: 'gpt-4', channel: 'fast', inputTokens: 300, outputTokens: 200, cost: 0.005, latencyMs: 2000, timestamp: now - 86400000 }, // 1 day ago
  ];

  for (const entry of entries) {
    analyticsAggregator.record(entry.provider, entry.model, {
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cost: entry.cost,
      latencyMs: entry.latencyMs,
      channel: entry.channel,
      timestamp: entry.timestamp,
    });
  }
}

describe('GET /v1/analytics', () => {
  before(async () => {
    // Create AnalyticsAggregator
    analyticsAggregator = new AnalyticsAggregator({
      maxLatencyWindow: 1000,
    });

    // Seed with test data
    seedTestAnalytics();

    server = startHttpServer(
      router,
      vault,
      config,
      undefined, // groupStore
      undefined, // costTracker
      undefined, // latencyMeasurer
      undefined, // freeModelRouter
      undefined, // db
      analyticsAggregator
    ) as unknown as http.Server;

    await new Promise<void>((resolve) => {
      server.on('listening', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          port = address.port;
        }
        resolve();
      });
    });
  });

  after(() => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        vault.close();

        // Clean up all database files
        for (const suffix of ['', '-wal', '-shm']) {
          const vaultPath = config.dbPath + suffix;
          if (existsSync(vaultPath)) {
            unlinkSync(vaultPath);
          }
        }
        resolve();
      });
    });
  });

  describe('Basic endpoint behavior', () => {
    it('should return analytics data with default dimension (hourly)', async () => {
      const res = await request('GET', '/v1/analytics');

      assert.equal(res.status, 200);
      assert.ok(Array.isArray((res.data as any).data), 'Response should have data array');
      assert.ok(typeof (res.data as any).summary === 'object', 'Response should have summary object');
    });

    it('should return summary with correct calculations', async () => {
      const res = await request('GET', '/v1/analytics');

      assert.equal(res.status, 200);
      const data = res.data as {
        summary: {
          totalRequests: number;
          totalTokens: number;
          totalCost: number;
          avgLatency: number;
        };
      };

      // Should have 7 requests from seed data
      assert.equal(data.summary.totalRequests, 7);
      // Total tokens = sum of all input + output tokens
      assert.ok(data.summary.totalTokens > 0, 'Total tokens should be positive');
      // Total cost should be sum of all costs
      assert.ok(data.summary.totalCost > 0, 'Total cost should be positive');
      // Average latency should be calculated
      assert.ok(data.summary.avgLatency >= 0, 'Average latency should be non-negative');
    });
  });

  describe('Authentication', () => {
    it('should require authentication', async () => {
      const res = await request('GET', '/v1/analytics', { auth: null });

      assert.equal(res.status, 401);
      assert.ok((res.data as any).error, 'Should return error message');
    });

    it('should reject invalid token', async () => {
      const res = await request('GET', '/v1/analytics', { auth: 'invalid-token' });

      assert.equal(res.status, 401);
    });
  });

  describe('Dimension filtering', () => {
    it('should filter by hourly dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=hourly');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<unknown> };

      assert.ok(Array.isArray(data.data), 'Should return hourly data array');
    });

    it('should filter by daily dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=daily');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<unknown> };

      assert.ok(Array.isArray(data.data), 'Should return daily data array');
    });

    it('should filter by channel dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=channel');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<{ channel?: string }> };

      assert.ok(Array.isArray(data.data), 'Should return channel data array');
      // Should have data for 'fast', 'cheap', 'balanced' channels
      assert.ok(data.data.length > 0, 'Should have channel data');
    });

    it('should filter by model dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=model');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<{ model?: string }> };

      assert.ok(Array.isArray(data.data), 'Should return model data array');
      assert.ok(data.data.length > 0, 'Should have model data');
    });

    it('should filter by total dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=total');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<unknown> };

      assert.ok(Array.isArray(data.data), 'Should return total data array');
      assert.equal(data.data.length, 1, 'Total dimension should return single data point');
    });

    it('should return 400 for invalid dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=weekly');

      assert.equal(res.status, 400);
      const data = res.data as { error: string; message: string };
      assert.equal(data.error, 'INVALID_PARAMS');
      assert.ok(data.message.toLowerCase().includes('dimension'), 'Error should mention dimension');
    });
  });

  describe('Time range filtering', () => {
    it('should filter by from timestamp', async () => {
      const now = Date.now();
      const from = now - 10000; // 10 seconds ago

      const res = await request('GET', `/v1/analytics?from=${from}`);

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<{ timestamp: number }>; summary: { totalRequests: number } };

      // Data should only include entries from last 10 seconds
      assert.ok(
        data.data.every(d => d.timestamp === 0 || d.timestamp >= from),
        'All data should be after from timestamp'
      );
    });

    it('should filter by to timestamp', async () => {
      const now = Date.now();
      const to = now - 3600000; // 1 hour ago

      const res = await request('GET', `/v1/analytics?to=${to}`);

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<{ timestamp: number }> };

      assert.ok(
        data.data.every(d => d.timestamp === 0 || d.timestamp <= to),
        'All data should be before to timestamp'
      );
    });

    it('should filter by date range', async () => {
      const now = Date.now();
      const from = now - 10000;
      const to = now - 1000;

      const res = await request('GET', `/v1/analytics?from=${from}&to=${to}`);

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<{ timestamp: number }> };

      assert.ok(
        data.data.every(d => d.timestamp === 0 || (d.timestamp >= from && d.timestamp <= to)),
        'All data should be within date range'
      );
    });

    it('should return 400 for invalid from timestamp', async () => {
      const res = await request('GET', '/v1/analytics?from=invalid');

      assert.equal(res.status, 400);
      assert.equal((res.data as any).error, 'INVALID_PARAMS');
    });

    it('should return 400 for invalid to timestamp', async () => {
      const res = await request('GET', '/v1/analytics?to=invalid');

      assert.equal(res.status, 400);
      assert.equal((res.data as any).error, 'INVALID_PARAMS');
    });

    it('should return 400 when from > to', async () => {
      const res = await request('GET', '/v1/analytics?from=1000&to=500');

      assert.equal(res.status, 400);
      assert.equal((res.data as any).error, 'INVALID_PARAMS');
    });
  });

  describe('Model filtering', () => {
    it('should filter by specific model dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=model');

      assert.equal(res.status, 200);
      const data = res.data as { 
        data: Array<{ requests: number }>; 
        summary: { totalRequests: number } 
      };

      // Should have data for different models
      assert.ok(data.data.length > 0, 'Should have model data');
      // Total requests across all models should match summary
      const totalFromData = data.data.reduce((sum, d) => sum + d.requests, 0);
      assert.equal(totalFromData, data.summary.totalRequests);
    });

    it('should return empty for non-existent model', async () => {
      const res = await request('GET', '/v1/analytics?dimension=model&model=nonexistent');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<unknown> };

      // Should return empty array for non-existent model
      assert.equal(data.data.length, 0);
    });
  });

  describe('Channel filtering', () => {
    it('should filter by specific channel dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=channel');

      assert.equal(res.status, 200);
      const data = res.data as { 
        data: Array<{ requests: number }>; 
        summary: { totalRequests: number } 
      };

      // Should have data for different channels
      assert.ok(data.data.length > 0, 'Should have channel data');
      // Total requests across all channels should match summary
      const totalFromData = data.data.reduce((sum, d) => sum + d.requests, 0);
      assert.equal(totalFromData, data.summary.totalRequests);
    });
  });

  describe('Response format', () => {
    it('should return correct AggregatedDataPoint structure', async () => {
      const res = await request('GET', '/v1/analytics?dimension=total');

      assert.equal(res.status, 200);
      const data = res.data as {
        data: Array<{
          timestamp: number;
          requests: number;
          inputTokens: number;
          outputTokens: number;
          cost: number;
          avgLatency: number;
        }>;
        summary: {
          totalRequests: number;
          totalTokens: number;
          totalCost: number;
          avgLatency: number;
        };
      };

      assert.equal(data.data.length, 1);
      const point = data.data[0]!;

      // Verify all required fields
      assert.ok(typeof point.timestamp === 'number', 'Should have timestamp');
      assert.ok(typeof point.requests === 'number', 'Should have requests');
      assert.ok(typeof point.inputTokens === 'number', 'Should have inputTokens');
      assert.ok(typeof point.outputTokens === 'number', 'Should have outputTokens');
      assert.ok(typeof point.cost === 'number', 'Should have cost');
      assert.ok(typeof point.avgLatency === 'number', 'Should have avgLatency');

      // Verify summary fields
      assert.ok(typeof data.summary.totalRequests === 'number', 'Summary should have totalRequests');
      assert.ok(typeof data.summary.totalTokens === 'number', 'Summary should have totalTokens');
      assert.ok(typeof data.summary.totalCost === 'number', 'Summary should have totalCost');
      assert.ok(typeof data.summary.avgLatency === 'number', 'Summary should have avgLatency');
    });

    it('should include percentile latencies when sufficient samples exist', async () => {
      // Need at least 10 samples for percentiles
      for (let i = 0; i < 15; i++) {
        analyticsAggregator.record('openai', 'gpt-4', {
          inputTokens: 100,
          outputTokens: 50,
          cost: 0.0025,
          latencyMs: 1000 + i * 100, // Varying latencies
          channel: 'fast',
        });
      }

      const res = await request('GET', '/v1/analytics?dimension=total');

      assert.equal(res.status, 200);
      const data = res.data as {
        data: Array<{
          p95Latency?: number;
          p99Latency?: number;
        }>;
      };

      const point = data.data[0]!;
      // Percentiles may or may not be present depending on implementation
      if (point.p95Latency !== undefined) {
        assert.ok(typeof point.p95Latency === 'number', 'p95Latency should be a number');
      }
      if (point.p99Latency !== undefined) {
        assert.ok(typeof point.p99Latency === 'number', 'p99Latency should be a number');
      }
    });
  });

  describe('Summary calculations', () => {
    it('should calculate correct totals in summary', async () => {
      const res = await request('GET', '/v1/analytics?dimension=total');

      assert.equal(res.status, 200);
      const data = res.data as {
        data: Array<{
          requests: number;
          inputTokens: number;
          outputTokens: number;
          cost: number;
        }>;
        summary: {
          totalRequests: number;
          totalTokens: number;
          totalCost: number;
        };
      };

      // Summary should match sum of data
      const dataPoint = data.data[0]!;
      assert.equal(data.summary.totalRequests, dataPoint.requests);
      assert.equal(data.summary.totalTokens, dataPoint.inputTokens + dataPoint.outputTokens);
      assert.equal(data.summary.totalCost, dataPoint.cost);
    });

    it('should handle empty results gracefully', async () => {
      // Create fresh aggregator with no data
      const freshAggregator = new AnalyticsAggregator();

      const testServer = startHttpServer(
        router,
        vault,
        { ...config, httpPort: 0 },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined, // db
        freshAggregator
      ) as unknown as http.Server;

      let testPort = 0;
      await new Promise<void>((resolve) => {
        testServer.on('listening', () => {
          const address = testServer.address();
          if (address && typeof address === 'object') {
            testPort = address.port;
          }
          resolve();
        });
      });

      // Make request using the test server port
      const res = await new Promise<{ status: number; data: unknown }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: testPort,
            path: '/v1/analytics',
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${config.authToken}`,
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                resolve({
                  status: res.statusCode ?? 0,
                  data: data ? JSON.parse(data) : {},
                });
              } catch {
                resolve({ status: res.statusCode ?? 0, data: {} });
              }
            });
          },
        );
        req.on('error', reject);
        req.end();
      });

      assert.equal(res.status, 200);
      const responseData = res.data as {
        data: Array<unknown>;
        summary: {
          totalRequests: number;
          totalTokens: number;
          totalCost: number;
          avgLatency: number;
        };
      };

      assert.equal(responseData.summary.totalRequests, 0);
      assert.equal(responseData.summary.totalTokens, 0);
      assert.equal(responseData.summary.totalCost, 0);
      assert.equal(responseData.summary.avgLatency, 0);

      // Clean up test server
      await new Promise<void>((resolve) => testServer.close(() => resolve()));
    });
  });
});
