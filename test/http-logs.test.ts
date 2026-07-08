/**
 * HTTP Logs API endpoint tests — GET /v1/logs
 *
 * TDD Red Phase: These tests define expected behavior for the logs API.
 * Following Task 1.2.3 from openspec/changes/octopus-features/tasks.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import http from 'node:http';
import Database from 'better-sqlite3';

import { Vault } from '../src/vault/vault.js';
import { getCircuitBreakerV2, resetCircuitBreakerV2, Router } from '../src/core/router.js';
import { createRouterExecutionContract } from '../src/core/router-execution-contract.js';
import type { GatewayConfig } from '../src/core/types.js';
import { startHttpServer } from '../src/server/http.js';
import { createAllAdapters } from '../src/adapters/index.js';
import { RequestLogger } from '../src/logging/request-logger.js';

// Streaming mocks below stub `router.resolveStreamingProviders` and must satisfy the
// `ResolvedStreamingProvider` contract, which requires an `executionContract` (added
// alongside per-attempt circuit-breaker + fallback metadata tracking). This helper builds
// a minimal, real contract so mocked candidates behave like production-resolved ones.
function mockExecutionContract(requestedModel?: string) {
  return createRouterExecutionContract({
    requestedModel,
    routingMetadata: { strategy: 'direct' },
  });
}

// Create test components
const config: GatewayConfig & { authToken: string } = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-http-logs-${Date.now()}.db`,
  httpPort: 0,
  authToken: 'test-token-12345',
};

// Separate database path for request logs
const logsDbPath = `/tmp/test-http-logs-logger-${Date.now()}.db`;

const vault = new Vault(config);
const router = new Router();

for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

let server: http.Server;
let port = 0;
let requestLogger: RequestLogger;
let logsDb: Database.Database;

// Helper function to make HTTP requests
async function request(
  method: string,
  path: string,
  opts?: { body?: object; auth?: string | null; headers?: Record<string, string> },
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
          ...(opts?.headers ?? {}),
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
  opts?: { body?: object; auth?: string | null; headers?: Record<string, string> },
): Promise<{ status: number; data: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts?.body ? JSON.stringify(opts.body) : undefined;
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
          ...(opts?.headers ?? {}),
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

function deleteLogsByModel(model: string): void {
  logsDb.prepare('DELETE FROM request_logs WHERE model = ?').run(model);
}

// Helper to seed the database with test logs
async function seedTestLogs(): Promise<void> {
  const now = Date.now();

  // Create diverse test logs
  const logs = [
    { timestamp: now - 1000, provider: 'openai', model: 'gpt-4', inputTokens: 100, outputTokens: 50, cost: 0.0025, latencyMs: 1200, attempts: 1 },
    { timestamp: now - 2000, provider: 'openai', model: 'gpt-3.5', inputTokens: 50, outputTokens: 25, cost: 0.001, latencyMs: 800, attempts: 1 },
    { timestamp: now - 3000, provider: 'groq', model: 'llama3-70b', inputTokens: 100, outputTokens: 100, cost: 0.001, latencyMs: 500, attempts: 1 },
    { timestamp: now - 4000, provider: 'anthropic', model: 'claude-3', inputTokens: 200, outputTokens: 150, cost: 0.003, latencyMs: 1500, attempts: 2 },
    { timestamp: now - 5000, provider: 'openai', model: 'gpt-4', inputTokens: 300, outputTokens: 200, cost: 0.005, latencyMs: 2000, attempts: 1 },
    { timestamp: now - 86400000, provider: 'groq', model: 'llama3-8b', inputTokens: 50, outputTokens: 50, cost: 0.0005, latencyMs: 300, attempts: 1 }, // 1 day ago
  ];

  for (const log of logs) {
    await requestLogger.capture({
      provider: log.provider,
      model: log.model,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      cost: log.cost,
      latencyMs: log.latencyMs,
      attempts: log.attempts,
    });
  }
}

describe('GET /v1/logs', () => {
  before(async () => {
    // Create separate database for request logs
    logsDb = new Database(logsDbPath);

    // Create the request_logs table
    logsDb.exec(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        total_tokens INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cost REAL,
        latency_ms INTEGER NOT NULL,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 1,
        correlation_id TEXT,
        request_data TEXT,
        response_data TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_provider ON request_logs(provider);
      CREATE INDEX IF NOT EXISTS idx_logs_model ON request_logs(model);
      CREATE INDEX IF NOT EXISTS idx_logs_correlation_id ON request_logs(correlation_id);
    `);

    // Create RequestLogger with the separate database
    requestLogger = new RequestLogger(logsDb);

    server = startHttpServer({
      router,
      vault,
      config,
      requestLogger,
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

    // Seed test data
    await seedTestLogs();
  });

  after(() => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        vault.close();
        logsDb.close();

        // Clean up all database files
        for (const suffix of ['', '-wal', '-shm']) {
          const vaultPath = config.dbPath + suffix;
          const logsPath = logsDbPath + suffix;
          if (existsSync(vaultPath)) {
            unlinkSync(vaultPath);
          }
          if (existsSync(logsPath)) {
            unlinkSync(logsPath);
          }
        }
        resolve();
      });
    });
  });

  describe('Basic endpoint behavior', () => {
    it('should return logs with default pagination', async () => {
      const res = await request('GET', '/v1/logs');

      assert.equal(res.status, 200);
      assert.ok(Array.isArray((res.data as any).logs), 'Response should have logs array');
      assert.ok(typeof (res.data as any).total === 'number', 'Response should have total count');
      assert.ok(typeof (res.data as any).limit === 'number', 'Response should have limit');
      assert.ok(typeof (res.data as any).offset === 'number', 'Response should have offset');
    });

    it('should return logs in descending timestamp order', async () => {
      const res = await request('GET', '/v1/logs?limit=5');

      assert.equal(res.status, 200);
      const data = res.data as { logs: Array<{ timestamp: number }> };
      assert.equal(data.logs.length, 5);

      // Verify descending order
      for (let i = 1; i < data.logs.length; i++) {
        assert.ok(
          data.logs[i - 1]!.timestamp >= data.logs[i]!.timestamp,
          'Logs should be in descending timestamp order'
        );
      }
    });
  });

  describe('Authentication', () => {
    it('should require authentication', async () => {
      const res = await request('GET', '/v1/logs', { auth: null });

      assert.equal(res.status, 401);
      assert.ok((res.data as any).error, 'Should return error message');
    });

    it('should reject invalid token', async () => {
      const res = await request('GET', '/v1/logs', { auth: 'invalid-token' });

      assert.equal(res.status, 401);
    });
  });

  describe('Filtering by provider', () => {
    it('should filter logs by provider', async () => {
      const res = await request('GET', '/v1/logs?provider=openai');

      assert.equal(res.status, 200);
      const data = res.data as { logs: Array<{ provider: string }>; total: number };

      assert.equal(data.logs.length, 3, 'Should return 3 openai logs');
      assert.equal(data.total, 3, 'Total should be 3');
      assert.ok(
        data.logs.every(log => log.provider === 'openai'),
        'All logs should be from openai'
      );
    });

    it('should filter logs by different provider', async () => {
      const res = await request('GET', '/v1/logs?provider=groq');

      assert.equal(res.status, 200);
      const data = res.data as { logs: Array<{ provider: string }>; total: number };

      assert.equal(data.total, 2, 'Should return 2 groq logs');
      assert.ok(
        data.logs.every(log => log.provider === 'groq'),
        'All logs should be from groq'
      );
    });

    it('should return empty result for non-existent provider', async () => {
      const res = await request('GET', '/v1/logs?provider=nonexistent');

      assert.equal(res.status, 200);
      const data = res.data as { logs: Array<unknown>; total: number };

      assert.equal(data.logs.length, 0);
      assert.equal(data.total, 0);
    });
  });

	describe('Filtering by correlation ID', () => {
		it('should expose and filter logs by correlationId', async () => {
			const correlationId = 'corr-http-logs-filter';

			const generateRes = await request('POST', '/v1/generate', {
				body: {
					model: 'mock-gpt',
					prompt: 'hello correlation',
				},
				headers: {
					'X-Correlation-ID': correlationId,
				},
			});

			assert.ok(generateRes.status === 200 || generateRes.status === 500);

			try {
				const logsRes = await request('GET', `/v1/logs?correlationId=${correlationId}`);
				assert.equal(logsRes.status, 200);

				const data = logsRes.data as {
					total: number;
					logs: Array<{
						correlationId?: string;
						model: string;
						requestData?: string;
						responseData?: string;
					}>;
				};

				assert.equal(data.total, 1);
				assert.equal(data.logs[0]?.correlationId, correlationId);
				assert.ok(!('requestData' in data.logs[0]!));
				assert.ok(!('responseData' in data.logs[0]!));
			} finally {
				logsDb.prepare('DELETE FROM request_logs WHERE correlation_id = ?').run(correlationId);
			}
		});
	});

  describe('Filtering by date range', () => {
    it('should filter logs by from timestamp', async () => {
      const now = Date.now();
      const from = now - 10000; // 10 seconds ago

      const res = await request('GET', `/v1/logs?from=${from}`);

      assert.equal(res.status, 200);
      const data = res.data as { logs: Array<{ timestamp: number }> };

      assert.ok(
        data.logs.every(log => log.timestamp >= from),
        'All logs should be after from timestamp'
      );
    });

    it('should filter logs by to timestamp', async () => {
      const now = Date.now();
      const to = now - 2000; // 2 seconds ago

      const res = await request('GET', `/v1/logs?to=${to}`);

      assert.equal(res.status, 200);
      const data = res.data as { logs: Array<{ timestamp: number }> };

      assert.ok(
        data.logs.every(log => log.timestamp <= to),
        'All logs should be before to timestamp'
      );
    });

    it('should filter logs by date range', async () => {
      const now = Date.now();
      const from = now - 5000;
      const to = now - 1000;

      const res = await request('GET', `/v1/logs?from=${from}&to=${to}`);

      assert.equal(res.status, 200);
      const data = res.data as { logs: Array<{ timestamp: number }> };

      assert.ok(
        data.logs.every(log => log.timestamp >= from && log.timestamp <= to),
        'All logs should be within date range'
      );
    });
  });

  describe('Pagination', () => {
    it('should respect limit parameter', async () => {
      const res = await request('GET', '/v1/logs?limit=2');

      assert.equal(res.status, 200);
      const data = res.data as { logs: Array<unknown>; limit: number };

      assert.equal(data.logs.length, 2);
      assert.equal(data.limit, 2);
    });

    it('should respect offset parameter', async () => {
      const firstPage = await request('GET', '/v1/logs?limit=2&offset=0');
      assert.equal(firstPage.status, 200);
      const firstData = firstPage.data as { logs: Array<{ id: number }>; offset: number };

      const secondPage = await request('GET', '/v1/logs?limit=2&offset=2');
      assert.equal(secondPage.status, 200);
      const secondData = secondPage.data as { logs: Array<{ id: number }>; offset: number };

      assert.equal(secondData.offset, 2);
      assert.notDeepEqual(firstData.logs[0], secondData.logs[0], 'Pages should have different items');
    });

    it('should return correct total count regardless of pagination', async () => {
      const res = await request('GET', '/v1/logs?limit=2&offset=0');

      assert.equal(res.status, 200);
      const data = res.data as { total: number; logs: Array<unknown> };

      assert.equal(data.total, 6, 'Total should be all logs (6)');
      assert.equal(data.logs.length, 2, 'But only return 2 per page');
    });
  });

  describe('Incident triage filters', () => {
    it('should filter failed, retried, and successful logs', async () => {
      await requestLogger.capture({
        provider: 'openai',
        model: 'triage-failed-model',
        latencyMs: 100,
        error: 'boom',
        attempts: 2,
      });
      await requestLogger.capture({
        provider: 'openai',
        model: 'triage-retried-model',
        latencyMs: 200,
        attempts: 3,
      });
      await requestLogger.capture({
        provider: 'openai',
        model: 'triage-success-model',
        latencyMs: 300,
        attempts: 1,
      });

      try {
        const failedRes = await request('GET', '/v1/logs?status=failed');
        const retriedRes = await request('GET', '/v1/logs?status=retried');
        const successfulRes = await request('GET', '/v1/logs?status=successful');

        assert.equal(failedRes.status, 200);
        assert.equal(retriedRes.status, 200);
        assert.equal(successfulRes.status, 200);

        const failedLogs = (failedRes.data as { logs: Array<{ model: string }> }).logs;
        const retriedLogs = (retriedRes.data as { logs: Array<{ model: string }> }).logs;
        const successfulLogs = (successfulRes.data as { logs: Array<{ model: string }> }).logs;

        assert.ok(failedLogs.some((log) => log.model === 'triage-failed-model'));
        assert.ok(!failedLogs.some((log) => log.model === 'triage-retried-model'));
        assert.ok(retriedLogs.some((log) => log.model === 'triage-retried-model'));
        assert.ok(!retriedLogs.some((log) => log.model === 'triage-failed-model'));
        assert.ok(successfulLogs.some((log) => log.model === 'triage-success-model'));
        assert.ok(!successfulLogs.some((log) => log.model === 'triage-retried-model'));
      } finally {
        deleteLogsByModel('triage-failed-model');
        deleteLogsByModel('triage-retried-model');
        deleteLogsByModel('triage-success-model');
      }
    });

    it('should filter logs by minimum latency', async () => {
      await requestLogger.capture({
        provider: 'openai',
        model: 'triage-latency-fast',
        latencyMs: 120,
      });
      await requestLogger.capture({
        provider: 'openai',
        model: 'triage-latency-slow',
        latencyMs: 950,
      });

      try {
        const res = await request('GET', '/v1/logs?minLatencyMs=900');

        assert.equal(res.status, 200);
        const data = res.data as { logs: Array<{ model: string; latencyMs: number }> };

        assert.ok(data.logs.some((log) => log.model === 'triage-latency-slow'));
        assert.ok(!data.logs.some((log) => log.model === 'triage-latency-fast'));
        assert.ok(data.logs.every((log) => log.latencyMs >= 900));
      } finally {
        deleteLogsByModel('triage-latency-fast');
        deleteLogsByModel('triage-latency-slow');
      }
    });
  });

  describe('Invalid query parameters', () => {
    it('should return 400 for invalid date range (from > to)', async () => {
      const res = await request('GET', '/v1/logs?from=1000&to=500');

      assert.equal(res.status, 400);
      assert.ok((res.data as any).error, 'Should have error field');
    });

    it('should return 400 for negative limit', async () => {
      const res = await request('GET', '/v1/logs?limit=-1');

      assert.equal(res.status, 400);
    });

    it('should return 400 for limit exceeding maximum', async () => {
      const res = await request('GET', '/v1/logs?limit=1001');

      assert.equal(res.status, 400);
    });

    it('should return 400 for negative offset', async () => {
      const res = await request('GET', '/v1/logs?offset=-1');

      assert.equal(res.status, 400);
    });

    it('should return 400 for non-numeric timestamp', async () => {
      const res = await request('GET', '/v1/logs?from=invalid');

      assert.equal(res.status, 400);
    });

    it('should return 400 for invalid status', async () => {
      const res = await request('GET', '/v1/logs?status=degraded');

      assert.equal(res.status, 400);
    });

    it('should return 400 for negative minLatencyMs', async () => {
      const res = await request('GET', '/v1/logs?minLatencyMs=-1');

      assert.equal(res.status, 400);
    });
  });

  describe('Response format', () => {
    it('should return public log entry format (no sensitive data)', async () => {
      const res = await request('GET', '/v1/logs?limit=1');

      assert.equal(res.status, 200);
      const data = res.data as {
        logs: Array<{
          id: number;
          timestamp: number;
          provider: string;
          model: string;
          correlationId?: string;
          totalTokens?: number;
          inputTokens?: number;
          outputTokens?: number;
          cost?: number;
          latencyMs: number;
          error?: string;
          attempts: number;
        }>;
      };

      const log = data.logs[0]!;
      assert.ok(typeof log.id === 'number', 'Should have id');
      assert.ok(typeof log.timestamp === 'number', 'Should have timestamp');
      assert.ok(typeof log.provider === 'string', 'Should have provider');
      assert.ok(typeof log.model === 'string', 'Should have model');
      assert.ok(log.correlationId === undefined || typeof log.correlationId === 'string', 'Should have optional correlationId');
      assert.ok(log.totalTokens === undefined || typeof log.totalTokens === 'number', 'Should have optional totalTokens');
      assert.ok(log.inputTokens === undefined || typeof log.inputTokens === 'number', 'Should have optional inputTokens');
      assert.ok(log.outputTokens === undefined || typeof log.outputTokens === 'number', 'Should have optional outputTokens');
      assert.ok(log.cost === undefined || typeof log.cost === 'number', 'Should have optional cost');
      assert.ok(typeof log.latencyMs === 'number', 'Should have latencyMs');
      assert.ok(typeof log.attempts === 'number', 'Should have attempts');

      // Should NOT contain sensitive data
      assert.ok(!('requestData' in log), 'Should not contain requestData');
      assert.ok(!('responseData' in log), 'Should not contain responseData');
    });
  });

  describe('Streaming request logging', () => {
    it('records streaming circuit-breaker success against the resolved model', async () => {
      resetCircuitBreakerV2();
      const requestedModel = 'stream-requested-model';
      const resolvedModel = 'stream-resolved-model';
      const originalResolveStreamingProviders = router.resolveStreamingProviders.bind(router);

      (router as any).resolveStreamingProviders = async () => ([
        {
          provider: { id: 'mock-stream-provider' },
          request: { model: resolvedModel, messages: [] },
          executionContract: mockExecutionContract(resolvedModel),
          streamTransformer: {
            name: 'mock-stream-provider',
            async *transformStream() {
              yield { content: 'Hello', done: false };
              yield { content: '', done: true, finishReason: 'stop' };
            },
          },
        },
      ]);

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
          body: {
            model: requestedModel,
            messages: [{ role: 'user', content: 'Hello breaker' }],
            stream: true,
          },
        });

        assert.equal(res.status, 200);

        const breaker = getCircuitBreakerV2();
        assert.equal(
          breaker.getState('mock-stream-provider', 'default', requestedModel),
          null,
        );
        assert.ok(breaker.getState('mock-stream-provider', 'default', resolvedModel));
      } finally {
        (router as any).resolveStreamingProviders = originalResolveStreamingProviders;
      }
    });

    it('logs successful streaming completions', async () => {
      const streamModel = 'stream-success-model';
      const originalResolveStreamingProviders = router.resolveStreamingProviders.bind(router);

      (router as any).resolveStreamingProviders = async () => ([
        {
          provider: { id: 'mock-stream-provider' },
          request: { model: streamModel, messages: [] },
          executionContract: mockExecutionContract(streamModel),
          streamTransformer: {
            name: 'mock-stream-provider',
            async *transformStream() {
              yield { content: 'Hello', done: false, model: streamModel };
              yield {
                content: '',
                done: true,
                model: streamModel,
                finishReason: 'stop',
                tokensIn: 7,
                tokensOut: 11,
              };
            },
          },
        },
      ]);

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
          body: {
            model: streamModel,
            messages: [{ role: 'user', content: 'Hello' }],
            stream: true,
          },
        });

        assert.equal(res.status, 200);
        assert.match(res.data, /data: \[DONE\]/);

        const logsRes = await request('GET', `/v1/logs?model=${streamModel}`);
        assert.equal(logsRes.status, 200);

         const data = logsRes.data as {
           total: number;
           logs: Array<{
             provider: string;
             model: string;
             inputTokens: number;
             outputTokens: number;
             attempts: number;
             error?: string;
           }>;
         };

        assert.equal(data.total, 1);
        assert.equal(data.logs[0]?.provider, 'mock-stream-provider');
         assert.equal(data.logs[0]?.model, streamModel);
         assert.equal(data.logs[0]?.inputTokens, 7);
         assert.equal(data.logs[0]?.outputTokens, 11);
         assert.equal(data.logs[0]?.attempts, 1);
         assert.equal(data.logs[0]?.error, undefined);
      } finally {
        (router as any).resolveStreamingProviders = originalResolveStreamingProviders;
        deleteLogsByModel(streamModel);
      }
    });

    it('serializes streaming chunks with the chunk model when it differs from the request model', async () => {
      const requestedModel = 'stream-request-model';
      const chunkModel = 'stream-chunk-model';
      const originalResolveStreamingProviders = router.resolveStreamingProviders.bind(router);

      (router as any).resolveStreamingProviders = async () => ([
        {
          provider: { id: 'mock-stream-provider' },
          request: { model: requestedModel, messages: [] },
          executionContract: mockExecutionContract(requestedModel),
          streamTransformer: {
            name: 'mock-stream-provider',
            async *transformStream() {
              yield { content: 'Hello', done: false, model: chunkModel };
              yield { content: '', done: true, model: chunkModel, finishReason: 'stop' };
            },
          },
        },
      ]);

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
          body: {
            model: requestedModel,
            messages: [{ role: 'user', content: 'Hello' }],
            stream: true,
          },
        });

        assert.equal(res.status, 200);
        const firstEventLine = res.data
          .split('\n')
          .find((line) => line.startsWith('data: {'));

        assert.ok(firstEventLine);

        const payload = JSON.parse(firstEventLine.slice(6)) as { model: string };
        assert.equal(payload.model, chunkModel);
      } finally {
        (router as any).resolveStreamingProviders = originalResolveStreamingProviders;
        deleteLogsByModel(chunkModel);
        deleteLogsByModel(requestedModel);
      }
    });

	it('logs streaming fallback completions', async () => {
		const requestedModel = 'stream-fallback-requested-model';
		const resolvedModel = 'stream-fallback-resolved-model';
		const originalResolveStreamingProviders = router.resolveStreamingProviders.bind(router);
		const originalGenerate = router.generate.bind(router);
		let observedRequest: Record<string, unknown> | undefined;

      const messages = [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
      ];

		(router as any).resolveStreamingProviders = async () => [];
		(router as any).generate = async (request: Record<string, unknown>) => {
			observedRequest = request;
			return {
				text: 'Fallback response',
				provider: 'mock-fallback',
				model: resolvedModel,
				tokensUsed: 5,
				requestedProvider: 'mock-fallback',
				requestedModel: requestedModel,
				resolvedProvider: 'mock-fallback',
				resolvedModel: resolvedModel,
				fallbackUsed: true,
			};
		};

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
			body: {
				model: requestedModel,
				messages,
				stream: true,
			},
        });

        assert.equal(res.status, 200);
			assert.match(res.data, /"object":"chat\.completion\.chunk"/);
			assert.match(res.data, /Fallback response/);
			assert.match(res.data, /data: \[DONE\]/);
			const firstEventLine = res.data
				.split('\n')
				.find((line) => line.startsWith('data: {'));
			assert.ok(firstEventLine);
			const payload = JSON.parse(firstEventLine.slice(6)) as {
				usage?: {
					prompt_tokens?: number;
					completion_tokens?: number;
					total_tokens?: number;
				};
			};
			assert.equal(payload.usage?.total_tokens, 5);
			assert.equal(payload.usage?.prompt_tokens, undefined);
			assert.equal(payload.usage?.completion_tokens, undefined);
			assert.deepEqual(observedRequest, {
				prompt: 'user: First question\nassistant: First answer\nuser: Second question',
				system: 'You are terse.',
				model: requestedModel,
				maxTokens: undefined,
				project: undefined,
				apiKeyId: undefined,
				userId: undefined,
			});

			const logsRes = await request('GET', `/v1/logs?model=${resolvedModel}`);
			assert.equal(logsRes.status, 200);

        const data = logsRes.data as {
          total: number;
			logs: Array<{
				provider: string;
				model: string;
				totalTokens?: number;
				outputTokens?: number;
				error?: string;
			}>;
		};

			assert.equal(data.total, 1);
			assert.equal(data.logs[0]?.provider, 'mock-fallback');
			assert.equal(data.logs[0]?.model, resolvedModel);
			assert.equal(data.logs[0]?.totalTokens, 5);
			assert.equal(data.logs[0]?.outputTokens, undefined);
			assert.equal(data.logs[0]?.error, undefined);
		} finally {
			(router as any).resolveStreamingProviders = originalResolveStreamingProviders;
			(router as any).generate = originalGenerate;
			deleteLogsByModel(requestedModel);
			deleteLogsByModel(resolvedModel);
		}
	});

    it('retries the next streaming-capable provider when failure happens before content', async () => {
      const streamModel = 'stream-prestart-fallback-model';
      const originalResolveStreamingProviders = router.resolveStreamingProviders.bind(router);

      (router as any).resolveStreamingProviders = async () => ([
        {
          provider: { id: 'failing-stream-provider' },
          request: { model: streamModel, messages: [] },
          executionContract: mockExecutionContract(streamModel),
          streamTransformer: {
            name: 'failing-stream-provider',
            async *transformStream() {
              yield { content: '', done: false, model: streamModel };
              throw new Error('startup failure');
            },
          },
        },
        {
          provider: { id: 'recovery-stream-provider' },
          request: { model: streamModel, messages: [] },
          executionContract: mockExecutionContract(streamModel),
          streamTransformer: {
            name: 'recovery-stream-provider',
            async *transformStream() {
              yield { content: 'Recovered', done: false, model: streamModel };
              yield { content: '', done: true, model: streamModel, finishReason: 'stop' };
            },
          },
        },
      ]);

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
          body: {
            model: streamModel,
            messages: [{ role: 'user', content: 'Hello error' }],
            stream: true,
          },
        });

        assert.equal(res.status, 200);
        assert.doesNotMatch(res.data, /startup failure/);
        assert.match(res.data, /Recovered/);
        assert.match(res.data, /data: \[DONE\]/);

        const logsRes = await request('GET', `/v1/logs?model=${streamModel}`);
        assert.equal(logsRes.status, 200);

        const data = logsRes.data as {
          total: number;
          logs: Array<{
            provider: string;
            model: string;
            attempts: number;
            error?: string;
          }>;
        };

        assert.equal(data.total, 1);
        assert.equal(data.logs[0]?.provider, 'recovery-stream-provider');
        assert.equal(data.logs[0]?.model, streamModel);
        assert.equal(data.logs[0]?.attempts, 2);
        assert.equal(data.logs[0]?.error, undefined);
      } finally {
        (router as any).resolveStreamingProviders = originalResolveStreamingProviders;
        deleteLogsByModel(streamModel);
      }
    });

    it('returns a streaming error when all streaming candidates fail before content', async () => {
      const streamModel = 'stream-exhausted-model';
      const originalResolveStreamingProviders = router.resolveStreamingProviders.bind(router);

      (router as any).resolveStreamingProviders = async () => ([
        {
          provider: { id: 'first-failing-provider' },
          request: { model: streamModel, messages: [] },
          executionContract: mockExecutionContract(streamModel),
          streamTransformer: {
            name: 'first-failing-provider',
            async *transformStream() {
              throw new Error('first startup failure');
            },
          },
        },
        {
          provider: { id: 'last-failing-provider' },
          request: { model: streamModel, messages: [] },
          executionContract: mockExecutionContract(streamModel),
          streamTransformer: {
            name: 'last-failing-provider',
            async *transformStream() {
              throw new Error('last startup failure');
            },
          },
        },
      ]);

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
          body: {
            model: streamModel,
            messages: [{ role: 'user', content: 'Hello exhausted' }],
            stream: true,
          },
        });

        assert.equal(res.status, 200);
        assert.match(res.data, /last startup failure/);
        assert.match(res.data, /data: \[DONE\]/);

        const logsRes = await request('GET', `/v1/logs?model=${streamModel}`);
        assert.equal(logsRes.status, 200);

        const data = logsRes.data as {
          total: number;
          logs: Array<{ provider: string; model: string; attempts: number; error?: string }>;
        };

        assert.equal(data.total, 1);
        assert.equal(data.logs[0]?.provider, 'last-failing-provider');
        assert.equal(data.logs[0]?.model, streamModel);
        assert.equal(data.logs[0]?.attempts, 2);
        assert.equal(data.logs[0]?.error, 'last startup failure');
      } finally {
        (router as any).resolveStreamingProviders = originalResolveStreamingProviders;
        deleteLogsByModel(streamModel);
      }
    });

    it('does not switch providers once stream content has been emitted', async () => {
      const streamModel = 'stream-no-midflight-fallback-model';
      const originalResolveStreamingProviders = router.resolveStreamingProviders.bind(router);
      let recoveryProviderCalls = 0;

      (router as any).resolveStreamingProviders = async () => ([
        {
          provider: { id: 'primary-stream-provider' },
          request: { model: streamModel, messages: [] },
          executionContract: mockExecutionContract(streamModel),
          streamTransformer: {
            name: 'primary-stream-provider',
            async *transformStream() {
              yield { content: 'partial', done: false, model: streamModel };
              throw new Error('mid-stream failure');
            },
          },
        },
        {
          provider: { id: 'recovery-stream-provider' },
          request: { model: streamModel, messages: [] },
          executionContract: mockExecutionContract(streamModel),
          streamTransformer: {
            name: 'recovery-stream-provider',
            async *transformStream() {
              recoveryProviderCalls += 1;
              yield { content: 'should-not-appear', done: false, model: streamModel };
              yield { content: '', done: true, model: streamModel, finishReason: 'stop' };
            },
          },
        },
      ]);

      try {
        const res = await requestText('POST', '/v1/chat/completions', {
          body: {
            model: streamModel,
            messages: [{ role: 'user', content: 'Hello mid-stream' }],
            stream: true,
          },
        });

        assert.equal(res.status, 200);
        assert.match(res.data, /partial/);
        assert.match(res.data, /mid-stream failure/);
        assert.doesNotMatch(res.data, /should-not-appear/);
        assert.equal(recoveryProviderCalls, 0);

        const logsRes = await request('GET', `/v1/logs?model=${streamModel}`);
        assert.equal(logsRes.status, 200);

        const data = logsRes.data as {
          total: number;
          logs: Array<{ provider: string; model: string; attempts: number; error?: string }>;
        };

        assert.equal(data.total, 1);
        assert.equal(data.logs[0]?.provider, 'primary-stream-provider');
        assert.equal(data.logs[0]?.model, streamModel);
        assert.equal(data.logs[0]?.attempts, 1);
        assert.equal(data.logs[0]?.error, 'mid-stream failure');
      } finally {
        (router as any).resolveStreamingProviders = originalResolveStreamingProviders;
        deleteLogsByModel(streamModel);
      }
    });
  });
});
