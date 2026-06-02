import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import http from 'node:http';

import { getMetrics, resetMetrics } from '../src/core/metrics.js';
import { Router } from '../src/core/router.js';
import { createStreamingRecordResult } from '../src/core/router-telemetry.js';
import type { GatewayConfig, GenerateRequest, GenerateResponse, LLMProvider } from '../src/core/types.js';
import { startHttpServer } from '../src/server/http.js';
import { Vault } from '../src/vault/vault.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-http-metrics-${Date.now()}.db`,
  httpPort: 0,
};

const failingProvider: LLMProvider = {
  id: 'broken-provider',
  name: 'broken-provider',
  type: 'api',
  models: [{ id: 'test-model', name: 'test-model', provider: 'broken-provider', maxTokens: 4096 }],
  async generate(_request: GenerateRequest): Promise<GenerateResponse> {
    throw new Error('broken provider');
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
};

const succeedingProvider: LLMProvider = {
  id: 'working-provider',
  name: 'working-provider',
  type: 'api',
  models: [{ id: 'test-model', name: 'test-model', provider: 'working-provider', maxTokens: 4096 }],
  async generate(_request: GenerateRequest): Promise<GenerateResponse> {
    return {
      text: 'ok',
      provider: 'working-provider',
      model: 'test-model',
      tokensUsed: 42,
      resolvedProvider: 'working-provider',
      resolvedModel: 'test-model',
      fallbackUsed: true,
    };
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
};

const streamingProvider: LLMProvider = {
  id: 'stream-provider',
  name: 'stream-provider',
  type: 'api',
  models: [{ id: 'stream-model', name: 'stream-model', provider: 'stream-provider', maxTokens: 4096 }],
  async generate(_request: GenerateRequest): Promise<GenerateResponse> {
    return {
      text: 'unused',
      provider: 'stream-provider',
      model: 'stream-model',
      resolvedProvider: 'stream-provider',
      resolvedModel: 'stream-model',
      fallbackUsed: false,
    };
  },
  async isAvailable(): Promise<boolean> {
    return true;
  },
};

const vault = new Vault(config);
const router = new Router();
router.register(failingProvider);
router.register(succeedingProvider);

let server: http.Server;
let port = 0;

async function requestJson(
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
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
            });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: {} });
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
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            headers: res.headers,
          });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

describe('Prometheus LLM metrics', () => {
  before(async () => {
    server = startHttpServer({ router, vault, config }) as unknown as http.Server;
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
        for (const suffix of ['', '-wal', '-shm']) {
          const filePath = config.dbPath + suffix;
          if (existsSync(filePath)) {
            unlinkSync(filePath);
          }
        }
        resolve();
      });
    });
  });

  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  it('exposes per-attempt request, duration, and token metrics through /metrics', async () => {
    const response = await requestJson('POST', '/v1/generate', {
      prompt: 'hello',
      model: 'test-model',
    });

    assert.equal(response.status, 200);

    const metrics = await requestText('GET', '/metrics');

    assert.equal(metrics.status, 200);
    assert.match(String(metrics.headers['content-type']), /text\/plain/);
    assert.match(
      metrics.body,
      /llm_requests_total\{provider="broken-provider",model="test-model",status="error"\} 1(?:\.0)?/,
    );
    assert.match(
      metrics.body,
      /llm_requests_total\{provider="working-provider",model="test-model",status="success"\} 1(?:\.0)?/,
    );
    assert.match(
      metrics.body,
      /llm_request_duration_seconds_count\{provider="broken-provider",model="test-model"\} 1(?:\.0)?/,
    );
    assert.match(
      metrics.body,
      /llm_request_duration_seconds_count\{provider="working-provider",model="test-model"\} 1(?:\.0)?/,
    );
    assert.match(
      metrics.body,
      /llm_tokens_used_total\{provider="working-provider",model="test-model"\} 42(?:\.0)?/,
    );
    assert.doesNotMatch(
      metrics.body,
      /llm_tokens_used_total\{provider="broken-provider",model="test-model"\}/,
    );
  });

  it('records streaming-path metrics through router telemetry when token counts are known', async () => {
    const recordStreamingResult = createStreamingRecordResult({
      telemetry: {
        analyticsAggregator: null,
        costTracker: null,
        modelRouter: null,
      },
      provider: streamingProvider,
      requestModel: 'stream-model',
    });

    recordStreamingResult({
      model: 'stream-model',
      tokensIn: 11,
      tokensOut: 7,
      latencyMs: 25,
      success: true,
      attempt: 1,
    });

    const metrics = await getMetrics();

    assert.match(
      metrics,
      /llm_requests_total\{provider="stream-provider",model="stream-model",status="success"\} 1(?:\.0)?/,
    );
    assert.match(
      metrics,
      /llm_request_duration_seconds_count\{provider="stream-provider",model="stream-model"\} 1(?:\.0)?/,
    );
    assert.match(
      metrics,
      /llm_tokens_used_total\{provider="stream-provider",model="stream-model"\} 18(?:\.0)?/,
    );
  });

	it('records HTTP 4xx responses and strips query strings from path labels', async () => {
		const response = await requestJson('POST', '/v1/generate', {});

		assert.equal(response.status, 400);

		await requestJson('GET', '/health?dimension=hourly');

		const metrics = await getMetrics();

		assert.match(
			metrics,
			/http_requests_total\{method="POST",path="\/v1\/generate",status="4xx"\} 1(?:\.0)?/,
		);
		assert.match(
			metrics,
			/http_request_duration_seconds_count\{method="POST",path="\/v1\/generate"\} 1(?:\.0)?/,
		);
		assert.match(
			metrics,
			/http_requests_total\{method="GET",path="\/health",status="2xx"\} 1(?:\.0)?/,
		);
		assert.doesNotMatch(metrics, /dimension=hourly/);
	});
});
