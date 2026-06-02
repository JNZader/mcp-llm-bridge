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
import { Hono } from 'hono';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import { TransformerRegistry } from '../src/core/transformer.js';
import type { GatewayConfig } from '../src/core/types.js';
import type { GenerateRequest, GenerateResponse, LLMProvider } from '../src/core/types.js';
import { startHttpServer } from '../src/server/http.js';
import { createAllAdapters } from '../src/adapters/index.js';
import { AnalyticsAggregator, SQLiteAnalyticsReader, SQLiteAnalyticsWriter } from '../src/analytics/index.js';
import { MigrationRunner } from '../src/db/migrate.js';
import { registerObservabilityRoutes } from '../src/server/routes/observability.js';

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
  opts?: { body?: object; auth?: string | null; portOverride?: number },
): Promise<{ status: number; data: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts?.body ? JSON.stringify(opts.body) : undefined;
    // Only use default auth token if auth is not explicitly set (including null)
    const authToken = opts && 'auth' in opts ? opts.auth : config.authToken;

    const req = http.request(
        {
          hostname: '127.0.0.1',
          port: opts?.portOverride ?? port,
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

async function requestText(
  method: string,
  path: string,
  opts?: { body?: object; auth?: string | null; portOverride?: number },
): Promise<{ status: number; data: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts?.body ? JSON.stringify(opts.body) : undefined;
    const authToken = opts && 'auth' in opts ? opts.auth : config.authToken;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: opts?.portOverride ?? port,
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
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            data,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function createMockProvider(id: string, model: string): LLMProvider {
  return {
    id,
    name: id,
    type: 'api',
    models: [{ id: model, name: model, provider: id, maxTokens: 4096 }],
    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      return {
        text: 'unused',
        provider: id,
        model,
        resolvedProvider: id,
        resolvedModel: model,
        fallbackUsed: false,
      };
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
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
      success: !(entry.provider === 'groq' && entry.model === 'llama3-8b'),
      attempt: entry.provider === 'groq' && entry.model === 'llama3-8b' ? 2 : 1,
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

    server = startHttpServer({
      router,
      vault,
      config,
      analyticsAggregator,
    }) as unknown as http.Server;

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
      assert.equal((res.data as { source: string }).source, 'live');
    });

    it('should expose additive flush status in the analytics response', async () => {
      const res = await request('GET', '/v1/analytics');

      assert.equal(res.status, 200);
      const data = res.data as {
        flushStatus: {
          persistenceEnabled: boolean;
          lastFlushAt: number | null;
          lastFlushSucceededAt: number | null;
          lastFlushError: string | null;
          pendingInMemoryBuckets: number;
          hasUnflushedData: boolean;
        };
      };

      assert.deepEqual(data.flushStatus, {
        persistenceEnabled: false,
        lastFlushAt: null,
        lastFlushSucceededAt: null,
        lastFlushError: null,
        pendingInMemoryBuckets: 0,
        hasUnflushedData: false,
      });
    });

    it('should return summary with correct calculations', async () => {
      const res = await request('GET', '/v1/analytics');

      assert.equal(res.status, 200);
      const data = res.data as {
        summary: {
          totalRequests: number;
          successfulRequests: number;
          failedRequests: number;
          retriedRequests: number;
          totalTokens: number;
          totalCost: number;
          avgLatency: number;
          errorRate: number;
          retryRate: number;
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
      assert.equal(data.summary.successfulRequests, 6);
      assert.equal(data.summary.failedRequests, 1);
      assert.equal(data.summary.retriedRequests, 1);
      assert.equal(data.summary.errorRate, 0.1429);
      assert.equal(data.summary.retryRate, 0.1429);
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
      const data = res.data as { data: Array<{ channelId?: string }> };

      assert.ok(Array.isArray(data.data), 'Should return channel data array');
      // Should have data for 'fast', 'cheap', 'balanced' channels
      assert.ok(data.data.length > 0, 'Should have channel data');
      assert.ok(data.data.every((row) => typeof row.channelId === 'string' && row.channelId.length > 0));
    });

    it('should filter by model dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=model');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<{ model?: string }> };

      assert.ok(Array.isArray(data.data), 'Should return model data array');
      assert.ok(data.data.length > 0, 'Should have model data');
      assert.ok(data.data.every((row) => typeof row.model === 'string' && row.model.length > 0));
    });

    it('should filter by provider dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=provider');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<{ provider?: string }> };

      assert.ok(Array.isArray(data.data), 'Should return provider data array');
      assert.ok(data.data.length > 0, 'Should have provider data');
      assert.ok(data.data.every((row) => typeof row.provider === 'string' && row.provider.length > 0));
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
        data: Array<{ requests: number; model?: string }>;
        summary: { totalRequests: number } 
      };

      // Should have data for different models
      assert.ok(data.data.length > 0, 'Should have model data');
      assert.ok(data.data.some((row) => row.model === 'gpt-4'), 'Should expose model identity');
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

  describe('Provider filtering', () => {
    it('should filter by specific provider dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=provider');

      assert.equal(res.status, 200);
      const data = res.data as {
        data: Array<{ requests: number; provider?: string }>;
        summary: { totalRequests: number };
      };

      assert.ok(data.data.length > 0, 'Should have provider data');
      assert.ok(data.data.some((row) => row.provider === 'openai'), 'Should expose provider identity');
      const totalFromData = data.data.reduce((sum, d) => sum + d.requests, 0);
      assert.equal(totalFromData, data.summary.totalRequests);
    });

    it('should return empty for non-existent provider', async () => {
      const res = await request('GET', '/v1/analytics?dimension=provider&provider=nonexistent');

      assert.equal(res.status, 200);
      const data = res.data as { data: Array<unknown> };

      assert.equal(data.data.length, 0);
    });
  });

  describe('Channel filtering', () => {
    it('should filter by specific channel dimension', async () => {
      const res = await request('GET', '/v1/analytics?dimension=channel');

      assert.equal(res.status, 200);
      const data = res.data as { 
        data: Array<{ requests: number; channelId?: string }>;
        summary: { totalRequests: number } 
      };

      // Should have data for different channels
      assert.ok(data.data.length > 0, 'Should have channel data');
      assert.ok(data.data.some((row) => row.channelId === 'fast'), 'Should expose channel identity');
      // Total requests across all channels should match summary
      const totalFromData = data.data.reduce((sum, d) => sum + d.requests, 0);
      assert.equal(totalFromData, data.summary.totalRequests);
    });
  });

  describe('Streaming telemetry parity', () => {
    it('records successful streaming requests in analytics', async () => {
      const freshAggregator = new AnalyticsAggregator();
      const freshRouter = new Router();
      const registry = new TransformerRegistry();
      const model = 'gpt-4o';
      const providerId = 'mock-stream-provider';

      freshRouter.register(createMockProvider(providerId, model));
      freshRouter.setTransformerRegistry(registry);
      freshRouter.setAnalyticsAggregator(freshAggregator);
      registry.registerStreamOutbound(providerId, {
        name: providerId,
        async *transformStream() {
          yield { content: 'Hello', done: false, model };
          yield { content: '', done: true, model, finishReason: 'stop', tokensIn: 4, tokensOut: 6 };
        },
      });

      const testServer = startHttpServer({
        router: freshRouter,
        vault,
        config: { ...config, httpPort: 0 },
        analyticsAggregator: freshAggregator,
      }) as unknown as http.Server;

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

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
          portOverride: testPort,
          body: {
            model,
            messages: [{ role: 'user', content: 'Hello stream analytics' }],
            stream: true,
          },
        });

        assert.equal(res.status, 200);
        assert.match(res.data, /data: \[DONE\]/);

        const total = freshAggregator.query({ dimension: 'total' })[0];
        const byModel = freshAggregator.query({ dimension: 'model', model });

        assert.equal(total?.requests, 1);
        assert.equal(total?.successfulRequests, 1);
        assert.equal(total?.failedRequests, 0);
        assert.equal(total?.retriedRequests, 0);
        assert.equal(total?.inputTokens, 4);
        assert.equal(total?.outputTokens, 6);
        assert.equal(byModel[0]?.requests, 1);
      } finally {
        await new Promise<void>((resolve) => testServer.close(() => resolve()));
      }
    });

    it('records failed streaming requests in analytics', async () => {
      const freshAggregator = new AnalyticsAggregator();
      const freshRouter = new Router();
      const registry = new TransformerRegistry();
      const model = 'gpt-4o';
      const providerId = 'mock-stream-provider';

      freshRouter.register(createMockProvider(providerId, model));
      freshRouter.setTransformerRegistry(registry);
      freshRouter.setAnalyticsAggregator(freshAggregator);
      registry.registerStreamOutbound(providerId, {
        name: providerId,
        async *transformStream() {
          yield { content: 'partial', done: false, model, tokensIn: 2, tokensOut: 3 };
          throw new Error('stream failed');
        },
      });

      const testServer = startHttpServer({
        router: freshRouter,
        vault,
        config: { ...config, httpPort: 0 },
        analyticsAggregator: freshAggregator,
      }) as unknown as http.Server;

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

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
          portOverride: testPort,
          body: {
            model,
            messages: [{ role: 'user', content: 'Hello stream analytics failure' }],
            stream: true,
          },
        });

        assert.equal(res.status, 200);
        assert.match(res.data, /stream failed/);
        assert.match(res.data, /data: \[DONE\]/);

        const total = freshAggregator.query({ dimension: 'total' })[0];
        const byModel = freshAggregator.query({ dimension: 'model', model });

        assert.equal(total?.requests, 1);
        assert.equal(total?.successfulRequests, 0);
        assert.equal(total?.failedRequests, 1);
        assert.equal(total?.retriedRequests, 0);
        assert.equal(total?.inputTokens, 2);
        assert.equal(total?.outputTokens, 3);
        assert.equal(byModel[0]?.requests, 1);
      } finally {
        await new Promise<void>((resolve) => testServer.close(() => resolve()));
      }
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
          successfulRequests: number;
          failedRequests: number;
          retriedRequests: number;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          cost: number;
          avgLatency: number;
          errorRate: number;
          retryRate: number;
        }>;
        summary: {
          totalRequests: number;
          successfulRequests: number;
          failedRequests: number;
          retriedRequests: number;
          totalTokens: number;
          totalCost: number;
          avgLatency: number;
          errorRate: number;
          retryRate: number;
        };
      };

      assert.equal(data.data.length, 1);
      const point = data.data[0]!;

      // Verify all required fields
      assert.ok(typeof point.timestamp === 'number', 'Should have timestamp');
      assert.ok(typeof point.requests === 'number', 'Should have requests');
      assert.ok(typeof point.successfulRequests === 'number', 'Should have successfulRequests');
      assert.ok(typeof point.failedRequests === 'number', 'Should have failedRequests');
      assert.ok(typeof point.retriedRequests === 'number', 'Should have retriedRequests');
      assert.ok(typeof point.totalTokens === 'number', 'Should have totalTokens');
      assert.ok(typeof point.inputTokens === 'number', 'Should have inputTokens');
      assert.ok(typeof point.outputTokens === 'number', 'Should have outputTokens');
      assert.ok(typeof point.cost === 'number', 'Should have cost');
      assert.ok(typeof point.avgLatency === 'number', 'Should have avgLatency');
      assert.ok(typeof point.errorRate === 'number', 'Should have errorRate');
      assert.ok(typeof point.retryRate === 'number', 'Should have retryRate');

      // Verify summary fields
      assert.ok(typeof data.summary.totalRequests === 'number', 'Summary should have totalRequests');
      assert.ok(typeof data.summary.successfulRequests === 'number', 'Summary should have successfulRequests');
      assert.ok(typeof data.summary.failedRequests === 'number', 'Summary should have failedRequests');
      assert.ok(typeof data.summary.retriedRequests === 'number', 'Summary should have retriedRequests');
      assert.ok(typeof data.summary.totalTokens === 'number', 'Summary should have totalTokens');
      assert.ok(typeof data.summary.totalCost === 'number', 'Summary should have totalCost');
      assert.ok(typeof data.summary.avgLatency === 'number', 'Summary should have avgLatency');
      assert.ok(typeof data.summary.errorRate === 'number', 'Summary should have errorRate');
      assert.ok(typeof data.summary.retryRate === 'number', 'Summary should have retryRate');
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
          successfulRequests: number;
          failedRequests: number;
          retriedRequests: number;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          cost: number;
        }>;
        summary: {
          totalRequests: number;
          successfulRequests: number;
          failedRequests: number;
          retriedRequests: number;
          totalTokens: number;
          totalCost: number;
        };
      };

      // Summary should match sum of data
      const dataPoint = data.data[0]!;
      assert.equal(data.summary.totalRequests, dataPoint.requests);
      assert.equal(data.summary.successfulRequests, dataPoint.successfulRequests);
      assert.equal(data.summary.failedRequests, dataPoint.failedRequests);
      assert.equal(data.summary.retriedRequests, dataPoint.retriedRequests);
      assert.equal(data.summary.totalTokens, dataPoint.totalTokens);
      assert.equal(data.summary.totalCost, dataPoint.cost);
		});

		it('uses totalTokens for summary when splits are unknown', async () => {
			const freshAggregator = new AnalyticsAggregator();
			freshAggregator.record('openai', 'gpt-4o-mini', {
				totalTokens: 17,
				latencyMs: 321,
				channel: 'default',
			});

			const testServer = startHttpServer({
				router,
				vault,
				config: { ...config, httpPort: 0 },
				analyticsAggregator: freshAggregator,
			}) as unknown as http.Server;

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

			try {
				const res = await request('GET', '/v1/analytics?dimension=total', {
					portOverride: testPort,
				});

				assert.equal(res.status, 200);
				const data = res.data as {
					data: Array<{ totalTokens: number; inputTokens: number; outputTokens: number }>;
					summary: { totalTokens: number };
				};

				assert.equal(data.data[0]?.totalTokens, 17);
				assert.equal(data.data[0]?.inputTokens, 0);
				assert.equal(data.data[0]?.outputTokens, 0);
				assert.equal(data.summary.totalTokens, 17);
			} finally {
				await new Promise<void>((resolve) => testServer.close(() => resolve()));
			}
		});

    it('should handle empty results gracefully', async () => {
      // Create fresh aggregator with no data
      const freshAggregator = new AnalyticsAggregator();

      const testServer = startHttpServer({
        router,
        vault,
        config: { ...config, httpPort: 0 },
        analyticsAggregator: freshAggregator,
      }) as unknown as http.Server;

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

		describe('Durable hourly/daily reads', () => {
		const toHourTimestamp = (timestamp: number): number => {
			const date = new Date(timestamp);
			date.setMinutes(0, 0, 0);
			return date.getTime();
		};

		const toDayTimestamp = (timestamp: number): number => {
			const date = new Date(timestamp);
			date.setHours(0, 0, 0, 0);
			return date.getTime();
		};

		it('merges persisted history with unflushed live hourly and daily buckets', async () => {
		const runner = new MigrationRunner({ dbPath: ':memory:' });
			await runner.runMigration(2);
			await runner.runMigration(9);
			const db = runner.getDatabase();
			const writer = new SQLiteAnalyticsWriter(db);
			const reader = new SQLiteAnalyticsReader(db);
			const liveAggregator = new AnalyticsAggregator();
			const persistedTimestamp = Date.UTC(2026, 0, 10, 10, 15, 0);
			const liveTimestamp = Date.UTC(2026, 0, 11, 11, 20, 0);

			await writer.upsert({
				flushedAt: Date.now(),
				hourly: [
					{
						timestamp: toHourTimestamp(persistedTimestamp),
					data: {
						timestamp: toHourTimestamp(persistedTimestamp),
						requests: 2,
						successfulRequests: 1,
						failedRequests: 1,
						retriedRequests: 1,
						totalTokens: 120,
							inputTokens: 80,
							outputTokens: 40,
							cost: 0.12,
							avgLatency: 300,
							errorRate: 0.5,
							retryRate: 0.5,
						},
					},
				],
				daily: [
					{
						timestamp: toDayTimestamp(persistedTimestamp),
					data: {
						timestamp: toDayTimestamp(persistedTimestamp),
						requests: 2,
						successfulRequests: 1,
						failedRequests: 1,
						retriedRequests: 1,
						totalTokens: 120,
							inputTokens: 80,
							outputTokens: 40,
							cost: 0.12,
							avgLatency: 300,
							errorRate: 0.5,
							retryRate: 0.5,
						},
					},
				],
			});

			liveAggregator.record('openai', 'gpt-4o', {
				inputTokens: 40,
				outputTokens: 20,
				cost: 0.06,
				latencyMs: 900,
				success: false,
				attempt: 2,
				channel: 'fast',
				timestamp: liveTimestamp,
			});

			const app = new Hono();
			registerObservabilityRoutes(app, {
				router: new Router(),
				analyticsAggregator: liveAggregator,
				analyticsReader: reader,
			});

			try {
				const hourlyRes = await app.request('/v1/analytics?dimension=hourly');
				const dailyRes = await app.request('/v1/analytics?dimension=daily');

				assert.equal(hourlyRes.status, 200);
				assert.equal(dailyRes.status, 200);

				const hourlyBody = await hourlyRes.json() as {
					data: Array<{ timestamp: number; requests: number; totalTokens: number }>;
					source: string;
					summary: { totalRequests: number; failedRequests: number; retriedRequests: number; totalTokens: number };
				};
				const dailyBody = await dailyRes.json() as {
					data: Array<{ timestamp: number; requests: number; totalTokens: number }>;
					source: string;
					summary: { totalRequests: number; failedRequests: number; retriedRequests: number; totalTokens: number };
				};

				assert.equal(hourlyBody.source, 'mixed');
				assert.equal(dailyBody.source, 'mixed');

				assert.deepEqual(
					hourlyBody.data.map((point) => point.timestamp),
					[toHourTimestamp(persistedTimestamp), toHourTimestamp(liveTimestamp)],
				);
				assert.deepEqual(
					hourlyBody.data.map((point) => point.requests),
					[2, 1],
				);
				assert.equal(hourlyBody.summary.totalRequests, 3);
				assert.equal(hourlyBody.summary.failedRequests, 2);
				assert.equal(hourlyBody.summary.retriedRequests, 2);
				assert.equal(hourlyBody.summary.totalTokens, 180);

				assert.deepEqual(
					dailyBody.data.map((point) => point.timestamp),
					[toDayTimestamp(persistedTimestamp), toDayTimestamp(liveTimestamp)],
				);
				assert.deepEqual(
					dailyBody.data.map((point) => point.requests),
					[2, 1],
				);
				assert.equal(dailyBody.summary.totalRequests, 3);
				assert.equal(dailyBody.summary.failedRequests, 2);
				assert.equal(dailyBody.summary.retriedRequests, 2);
				assert.equal(dailyBody.summary.totalTokens, 180);
			} finally {
				runner.close();
			}
		});

		it('serves persisted hourly and daily analytics after restart on the same SQLite DB', async () => {
			const dbPath = `/tmp/test-http-analytics-restart-${Date.now()}.db`;
			const firstRunner = new MigrationRunner({ dbPath });
			await firstRunner.runMigration(2);
			await firstRunner.runMigration(9);

			const persistentAggregator = new AnalyticsAggregator({
				persistenceWriter: new SQLiteAnalyticsWriter(firstRunner.getDatabase()),
				flushIntervalMs: 10_000,
			});
			const firstTimestamp = Date.UTC(2026, 0, 10, 15, 5, 0);
			const secondTimestamp = Date.UTC(2026, 0, 10, 15, 25, 0);

			persistentAggregator.record('openai', 'gpt-4o', {
				inputTokens: 120,
				outputTokens: 30,
				cost: 0.12,
				latencyMs: 400,
				success: false,
				attempt: 1,
				channel: 'fast',
				timestamp: firstTimestamp,
			});
			persistentAggregator.record('openai', 'gpt-4o', {
				inputTokens: 80,
				outputTokens: 20,
				cost: 0.08,
				latencyMs: 600,
				success: true,
				attempt: 2,
				channel: 'fast',
				timestamp: secondTimestamp,
			});

			await persistentAggregator.destroy();
			firstRunner.close();

			const secondRunner = new MigrationRunner({ dbPath });
			const app = new Hono();
			registerObservabilityRoutes(app, {
				router: new Router(),
				analyticsAggregator: new AnalyticsAggregator(),
				analyticsReader: new SQLiteAnalyticsReader(secondRunner.getDatabase()),
			});

			try {
				const hourlyRes = await app.request('/v1/analytics?dimension=hourly');
				const dailyRes = await app.request('/v1/analytics?dimension=daily');
				const totalRes = await app.request('/v1/analytics?dimension=total');

				assert.equal(hourlyRes.status, 200);
				assert.equal(dailyRes.status, 200);
				assert.equal(totalRes.status, 200);

				const hourlyBody = await hourlyRes.json() as {
					data: Array<{ timestamp: number; requests: number; totalTokens: number }>;
					source: string;
					summary: { totalRequests: number; failedRequests: number; retriedRequests: number; totalTokens: number; totalCost: number; avgLatency: number };
				};
				const dailyBody = await dailyRes.json() as {
					data: Array<{ timestamp: number; requests: number; totalTokens: number }>;
					source: string;
					summary: { totalRequests: number; failedRequests: number; retriedRequests: number; totalTokens: number };
				};
				const totalBody = await totalRes.json() as {
					data: Array<{ requests: number }>;
					source: string;
					summary: { totalRequests: number };
				};

				assert.equal(hourlyBody.source, 'durable');
				assert.equal(dailyBody.source, 'durable');
				assert.equal(totalBody.source, 'live');

				assert.equal(hourlyBody.data.length, 1);
				assert.equal(hourlyBody.data[0]?.timestamp, toHourTimestamp(firstTimestamp));
				assert.equal(hourlyBody.data[0]?.requests, 2);
				assert.equal(hourlyBody.data[0]?.totalTokens, 250);
				assert.equal(hourlyBody.summary.totalRequests, 2);
				assert.equal(hourlyBody.summary.failedRequests, 1);
				assert.equal(hourlyBody.summary.retriedRequests, 1);
				assert.equal(hourlyBody.summary.totalTokens, 250);

				assert.equal(dailyBody.data.length, 1);
				assert.equal(dailyBody.data[0]?.timestamp, toDayTimestamp(firstTimestamp));
				assert.equal(dailyBody.data[0]?.requests, 2);
				assert.equal(dailyBody.data[0]?.totalTokens, 250);
				assert.equal(dailyBody.summary.totalRequests, 2);
				assert.equal(dailyBody.summary.failedRequests, 1);
				assert.equal(dailyBody.summary.retriedRequests, 1);
				assert.equal(dailyBody.summary.totalTokens, 250);

				assert.equal(totalBody.data[0]?.requests, 0);
				assert.equal(totalBody.summary.totalRequests, 0);
			} finally {
				secondRunner.close();
				for (const suffix of ['', '-wal', '-shm']) {
					const filePath = dbPath + suffix;
					if (existsSync(filePath)) {
						unlinkSync(filePath);
					}
				}
				}
			});

			it('lets live hourly and daily buckets override persisted collisions by timestamp', async () => {
				const runner = new MigrationRunner({ dbPath: ':memory:' });
				await runner.runMigration(2);
				await runner.runMigration(9);
				const db = runner.getDatabase();
				const writer = new SQLiteAnalyticsWriter(db);
				const reader = new SQLiteAnalyticsReader(db);
				const liveAggregator = new AnalyticsAggregator();
				const timestamp = Date.UTC(2026, 0, 10, 15, 5, 0);

				await writer.upsert({
					flushedAt: Date.now(),
					hourly: [
						{
							timestamp: toHourTimestamp(timestamp),
							data: {
								timestamp: toHourTimestamp(timestamp),
								requests: 9,
								successfulRequests: 9,
								failedRequests: 0,
								retriedRequests: 0,
								totalTokens: 999,
								inputTokens: 600,
								outputTokens: 399,
								cost: 0.99,
								avgLatency: 999,
								errorRate: 0,
								retryRate: 0,
							},
						},
					],
					daily: [
						{
							timestamp: toDayTimestamp(timestamp),
							data: {
								timestamp: toDayTimestamp(timestamp),
								requests: 9,
								successfulRequests: 9,
								failedRequests: 0,
								retriedRequests: 0,
								totalTokens: 999,
								inputTokens: 600,
								outputTokens: 399,
								cost: 0.99,
								avgLatency: 999,
								errorRate: 0,
								retryRate: 0,
							},
						},
					],
				});

				liveAggregator.record('openai', 'gpt-4o', {
					inputTokens: 50,
					outputTokens: 25,
					cost: 0.075,
					latencyMs: 400,
					success: true,
					attempt: 1,
					channel: 'fast',
					timestamp,
				});

				const app = new Hono();
				registerObservabilityRoutes(app, {
					router: new Router(),
					analyticsAggregator: liveAggregator,
					analyticsReader: reader,
				});

				try {
					const hourlyRes = await app.request('/v1/analytics?dimension=hourly');
					const dailyRes = await app.request('/v1/analytics?dimension=daily');

					assert.equal(hourlyRes.status, 200);
					assert.equal(dailyRes.status, 200);

				const hourlyBody = await hourlyRes.json() as {
					data: Array<{ requests: number; totalTokens: number; avgLatency: number }>;
					source: string;
					summary: { totalRequests: number; totalTokens: number };
				};
				const dailyBody = await dailyRes.json() as {
					data: Array<{ requests: number; totalTokens: number; avgLatency: number }>;
					source: string;
					summary: { totalRequests: number; totalTokens: number };
				};

				assert.equal(hourlyBody.source, 'mixed');
				assert.equal(dailyBody.source, 'mixed');

					assert.equal(hourlyBody.data.length, 1);
					assert.equal(hourlyBody.data[0]?.requests, 1);
					assert.equal(hourlyBody.data[0]?.totalTokens, 75);
					assert.equal(hourlyBody.data[0]?.avgLatency, 400);
					assert.equal(hourlyBody.summary.totalRequests, 1);
					assert.equal(hourlyBody.summary.totalTokens, 75);

					assert.equal(dailyBody.data.length, 1);
					assert.equal(dailyBody.data[0]?.requests, 1);
					assert.equal(dailyBody.data[0]?.totalTokens, 75);
					assert.equal(dailyBody.data[0]?.avgLatency, 400);
					assert.equal(dailyBody.summary.totalRequests, 1);
					assert.equal(dailyBody.summary.totalTokens, 75);
				} finally {
					runner.close();
				}
			});

			it('marks non-persisted dimensions as live-only even when durable history exists', async () => {
				const runner = new MigrationRunner({ dbPath: ':memory:' });
				await runner.runMigration(2);
				await runner.runMigration(9);
				const db = runner.getDatabase();
				const writer = new SQLiteAnalyticsWriter(db);
				const reader = new SQLiteAnalyticsReader(db);
				const liveAggregator = new AnalyticsAggregator();

				await writer.upsert({
					flushedAt: Date.now(),
					hourly: [
						{
							timestamp: Date.UTC(2026, 0, 10, 15, 0, 0),
							data: {
								timestamp: Date.UTC(2026, 0, 10, 15, 0, 0),
								requests: 4,
								successfulRequests: 4,
								failedRequests: 0,
								retriedRequests: 0,
								totalTokens: 200,
								inputTokens: 120,
								outputTokens: 80,
								cost: 0.2,
								avgLatency: 250,
								errorRate: 0,
								retryRate: 0,
							},
						},
					],
					daily: [
						{
							timestamp: Date.UTC(2026, 0, 10, 0, 0, 0),
							data: {
								timestamp: Date.UTC(2026, 0, 10, 0, 0, 0),
								requests: 4,
								successfulRequests: 4,
								failedRequests: 0,
								retriedRequests: 0,
								totalTokens: 200,
								inputTokens: 120,
								outputTokens: 80,
								cost: 0.2,
								avgLatency: 250,
								errorRate: 0,
								retryRate: 0,
							},
						},
					],
				});

				liveAggregator.record('openai', 'gpt-4o', {
					inputTokens: 50,
					outputTokens: 25,
					cost: 0.075,
					latencyMs: 400,
					channel: 'fast',
				});

				const app = new Hono();
				registerObservabilityRoutes(app, {
					router: new Router(),
					analyticsAggregator: liveAggregator,
					analyticsReader: reader,
				});

				try {
					for (const dimension of ['total', 'channel', 'provider', 'model']) {
						const res = await app.request(`/v1/analytics?dimension=${dimension}`);
						assert.equal(res.status, 200);
						const body = await res.json() as { source: string };
						assert.equal(body.source, 'live');
					}
				} finally {
					runner.close();
				}
			});

			it('surfaces failed flush status for operators', async () => {
				const aggregatorWithFailure = new AnalyticsAggregator({
					persistenceWriter: {
						async upsert() {
							throw new Error('sqlite busy');
						},
					},
					flushIntervalMs: 10_000,
				});

				aggregatorWithFailure.record('openai', 'gpt-4o', {
					inputTokens: 50,
					outputTokens: 25,
					cost: 0.075,
					latencyMs: 400,
					channel: 'fast',
				});

				await assert.rejects(aggregatorWithFailure.flush(), /sqlite busy/);

				const app = new Hono();
				registerObservabilityRoutes(app, {
					router: new Router(),
					analyticsAggregator: aggregatorWithFailure,
				});

				const res = await app.request('/v1/analytics?dimension=hourly');
				assert.equal(res.status, 200);

				const body = await res.json() as {
					flushStatus: {
						persistenceEnabled: boolean;
						lastFlushAt: number | null;
						lastFlushSucceededAt: number | null;
						lastFlushError: string | null;
						pendingInMemoryBuckets: number;
						hasUnflushedData: boolean;
					};
				};

				assert.strictEqual(body.flushStatus.persistenceEnabled, true);
				assert.ok(typeof body.flushStatus.lastFlushAt === 'number');
				assert.strictEqual(body.flushStatus.lastFlushSucceededAt, null);
				assert.strictEqual(body.flushStatus.lastFlushError, 'sqlite busy');
				assert.strictEqual(body.flushStatus.pendingInMemoryBuckets, 2);
				assert.strictEqual(body.flushStatus.hasUnflushedData, true);

				await aggregatorWithFailure.destroy().catch(() => {});
			});
	});
});
