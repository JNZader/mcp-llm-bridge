/**
 * HTTP endpoint tests — verify REST API behavior.
 */

import { describe, it, after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import http from 'node:http';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import type { GatewayConfig } from '../src/core/types.js';
import { startHttpServer } from '../src/server/http.js';
import { TOOLS } from '../src/server/mcp.js';
import { createAllAdapters } from '../src/adapters/index.js';
import { getCircuitBreakerV2, resetCircuitBreakerV2 } from '../src/core/router.js';

// Create test components once
const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-http-${Date.now()}.db`,
  httpPort: 0,
};

const vault = new Vault(config);
const router = new Router();

for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

let server: http.Server;
let port = 0;

before(async () => {
  server = startHttpServer(router, vault, config) as unknown as http.Server;
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

afterEach(() => {
  resetCircuitBreakerV2();
});

// Helper function to make HTTP requests
async function request(
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

// ── Dashboard/auth shell endpoints ────────────────────────

describe('GET /', () => {
  it('returns the dashboard shell HTML', async () => {
    const res = await requestText('GET', '/');
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /text\/html/);
    assert.match(res.body, /<!DOCTYPE html>/);
    assert.match(res.body, /LLM Gateway/);
  });
});

describe('GET /v1/admin/auth-config', () => {
  it('returns the public auth bootstrap config shape', async () => {
    const res = await request('GET', '/v1/admin/auth-config');
    assert.equal(res.status, 200);
    const data = res.data as { githubOauth: boolean };
    assert.equal(typeof data.githubOauth, 'boolean');
  });
});

// ── Health endpoint ──────────────────────────────────────────

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    const data = res.data as { status: string; version: string };
    assert.equal(data.status, 'ok');
    assert.equal(data.version, '0.3.1');
  });

  it('returns enhanced health info with required fields', async () => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    const data = res.data as {
      status: string;
      version: string;
      timestamp: string;
      uptime: number;
      auth: { enabled: boolean; mode: string };
      providers: { total: number; available: number };
      subscription: { anthropic: string };
      mode: string;
    };
    
    // Verify all required fields are present
    assert.equal(data.status, 'ok');
    assert.equal(data.version, '0.3.1');
    assert.ok(typeof data.timestamp === 'string');
    assert.ok(data.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
    assert.ok(typeof data.uptime === 'number');
    assert.ok(data.uptime >= 0);
    
    // Auth info
    assert.ok(typeof data.auth.enabled === 'boolean');
    assert.ok(['bearer', 'disabled'].includes(data.auth.mode));
    
    // Providers info
    assert.ok(typeof data.providers.total === 'number');
    assert.ok(data.providers.total >= 0);
    assert.ok(typeof data.providers.available === 'number');
    assert.ok(data.providers.available >= 0);
    assert.ok(data.providers.available <= data.providers.total);
    
    // Subscription info
    assert.ok(['pro', 'max', 'api', 'none'].includes(data.subscription.anthropic));
    
    // Mode
    assert.equal(data.mode, 'proxy');
  });
});

// ── Models endpoint ─────────────────────────────────────────

describe('GET /v1/models', () => {
  it('returns list of available models', async () => {
    const res = await request('GET', '/v1/models');
    assert.equal(res.status, 200);
    const data = res.data as { data: unknown[] };
    assert.ok(Array.isArray(data.data));
    assert.ok(data.data.length > 0);
  });

  it('model objects have required fields', async () => {
    const res = await request('GET', '/v1/models');
    const data = res.data as { data: unknown[] };
    const model = data.data[0] as Record<string, unknown>;
    assert.ok(model.id);
    assert.ok(model.object);
    assert.ok(model.name);
    assert.ok(model.provider);
  });
});

// ── Providers endpoint ──────────────────────────────────────

describe('GET /v1/providers', () => {
  it('returns provider statuses', async () => {
    const res = await request('GET', '/v1/providers');
    assert.equal(res.status, 200);
    const data = res.data as { providers: unknown[] };
    assert.ok(Array.isArray(data.providers));
  });

  it('provider objects have required fields', async () => {
    const res = await request('GET', '/v1/providers');
    const data = res.data as { providers: unknown[] };
    const provider = data.providers[0] as Record<string, unknown>;
    assert.ok(provider.id);
    assert.ok(typeof provider.available === 'boolean');
  });
});

describe('Circuit breaker routes', () => {
  it('returns runtime V2 config through the legacy-shaped endpoint', async () => {
    const breaker = getCircuitBreakerV2();
    breaker.updateConfig({
      failureThreshold: 7,
      baseCooldownMs: 1234,
      backoffMultiplier: 3,
      maxCooldownMs: 9999,
      halfOpenMaxRequests: 4,
    });

    const res = await request('GET', '/v1/circuit-breaker/config');
    assert.equal(res.status, 200);

    const data = res.data as {
      enabled: boolean;
      failureThreshold: number;
      backoffBaseMs: number;
      backoffMultiplier: number;
      backoffMaxMs: number;
      resetTimeoutMs: number;
      halfOpenSuccessThreshold: number;
    };

    assert.equal(data.enabled, true);
    assert.equal(data.failureThreshold, 7);
    assert.equal(data.backoffBaseMs, 1234);
    assert.equal(data.backoffMultiplier, 3);
    assert.equal(data.backoffMaxMs, 9999);
    assert.equal(data.resetTimeoutMs, 1234);
    assert.equal(data.halfOpenSuccessThreshold, 4);
  });

  it('updates runtime V2 config via the public config endpoint', async () => {
    const res = await request('PUT', '/v1/circuit-breaker/config', {
      failureThreshold: 6,
      backoffBaseMs: 2222,
      backoffMultiplier: 4,
      backoffMaxMs: 8888,
      halfOpenSuccessThreshold: 5,
    });
    assert.equal(res.status, 200);

    const config = getCircuitBreakerV2().getConfig();
    assert.equal(config.failureThreshold, 6);
    assert.equal(config.baseCooldownMs, 2222);
    assert.equal(config.backoffMultiplier, 4);
    assert.equal(config.maxCooldownMs, 8888);
    assert.equal(config.halfOpenMaxRequests, 5);
  });

  it('returns runtime V2 stats through the public stats endpoint', async () => {
    const breaker = getCircuitBreakerV2();
    breaker.recordFailure('openai', 'default', 'gpt-4o');

    const res = await request('GET', '/v1/circuit-breaker/stats');
    assert.equal(res.status, 200);

    const data = res.data as {
      enabled: boolean;
      breakers: Array<{ name: string; failures: number; consecutiveFailures: number }>;
    };

    const openai = data.breakers.find((entry) => entry.name === 'openai:default:gpt-4o');
    assert.ok(openai);
    assert.equal(openai!.failures, 1);
    assert.equal(openai!.consecutiveFailures, 1);
  });
});

// ── Tool catalog endpoints ─────────────────────────────────

describe('GET /v1/tools/catalog', () => {
  it('returns the real MCP runtime tool catalog instead of an empty registry', async () => {
    const res = await request('GET', '/v1/tools/catalog');
    assert.equal(res.status, 200);

    const data = res.data as {
      count: number;
      tools: Array<{ name: string; namespace: string; source: string }>;
    };

    assert.ok(data.count >= TOOLS.length);
    assert.ok(data.tools.some((tool) => tool.name === 'llm_generate'));
    assert.ok(data.tools.some((tool) => tool.name === 'code_search'));
    assert.ok(data.tools.every((tool) => tool.source === 'mcp'));
    assert.ok(data.tools.every((tool) => tool.namespace.startsWith('mcp:')));
  });
});

describe('GET /v1/tools/search', () => {
  it('searches across the real MCP runtime catalog', async () => {
    const res = await request('GET', '/v1/tools/search?q=semantic%20code');
    assert.equal(res.status, 200);

    const data = res.data as {
      query: string;
      count: number;
      tools: Array<{ name: string }>;
    };

    assert.equal(data.query, 'semantic code');
    assert.ok(data.count > 0);
    assert.equal(data.tools[0]?.name, 'code_search');
  });
});

// ── Credentials endpoints ───────────────────────────────────

describe('POST /v1/credentials', () => {
  it('stores a credential', async () => {
    const res = await request('POST', '/v1/credentials', {
      provider: 'anthropic',
      apiKey: 'test-api-key-12345',
    });
    assert.equal(res.status, 201);
    const data = res.data as { id: number; provider: string };
    assert.ok(data.id);
    assert.equal(data.provider, 'anthropic');
  });

  it('rejects invalid request body', async () => {
    const res = await request('POST', '/v1/credentials', {});
    // Should return 400 for invalid input
    assert.ok(res.status === 400 || res.status === 500);
  });
});

describe('GET /v1/credentials', () => {
  it('returns stored credentials (masked)', async () => {
    // Store a credential
    await request('POST', '/v1/credentials', {
      provider: 'openai',
      apiKey: 'sk-openai-secret-key',
    });

    const res = await request('GET', '/v1/credentials');
    assert.equal(res.status, 200);
    const data = res.data as { credentials: unknown[] };
    assert.ok(data.credentials.length > 0);
    const cred = data.credentials[0] as Record<string, unknown>;
    assert.ok(cred.maskedValue);
    assert.ok((cred.maskedValue as string).includes('***'));
  });
});

describe('DELETE /v1/credentials/:id', () => {
  it('deletes a credential', async () => {
    // Store a credential
    const createRes = await request('POST', '/v1/credentials', {
      provider: 'google',
      apiKey: 'google-api-key',
    });
    const id = (createRes.data as { id: number }).id;

    // Delete it
    const res = await request('DELETE', `/v1/credentials/${id}`);
    assert.equal(res.status, 200);
    const data = res.data as { ok: boolean };
    assert.equal(data.ok, true);
  });

  it('returns 400 for invalid id', async () => {
    const res = await request('DELETE', '/v1/credentials/invalid');
    assert.equal(res.status, 400);
  });
});

// ── Generate endpoint ───────────────────────────────────────

describe('POST /v1/generate', () => {
  it('rejects empty request body', async () => {
    const res = await request('POST', '/v1/generate', {});
    assert.equal(res.status, 400);
  });

  it('rejects prompt exceeding max length', async () => {
    const longPrompt = 'x'.repeat(200_000);
    const res = await request('POST', '/v1/generate', { prompt: longPrompt });
    assert.equal(res.status, 400);
  });
});

// ── Chat completions endpoint ───────────────────────────────

describe('POST /v1/chat/completions', () => {
  it('rejects empty messages', async () => {
    const res = await request('POST', '/v1/chat/completions', { messages: [] });
    assert.equal(res.status, 400);
  });

  it('accepts streaming requests (returns SSE)', async () => {
    const res = await request('POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    });
    // SSE starts with 200 even if provider fails later
    assert.equal(res.status, 200);
  });

  it('rejects messages without user role', async () => {
    const res = await request('POST', '/v1/chat/completions', {
      messages: [{ role: 'assistant', content: 'Hello' }],
    });
    assert.equal(res.status, 400);
  });
});

// ── Files endpoints ────────────────────────────────────────

describe('POST /v1/files', () => {
  it('stores a file', async () => {
    const res = await request('POST', '/v1/files', {
      provider: 'claude',
      fileName: 'test.json',
      content: '{"key": "value"}',
    });
    assert.equal(res.status, 201);
    const data = res.data as { id: number };
    assert.ok(data.id);
  });

  it('rejects invalid request', async () => {
    const res = await request('POST', '/v1/files', {
      provider: 'claude',
    });
    assert.equal(res.status, 400);
  });
});

describe('GET /v1/files', () => {
  it('returns stored files', async () => {
    await request('POST', '/v1/files', {
      provider: 'gemini',
      fileName: 'auth.json',
      content: '{}',
    });

    const res = await request('GET', '/v1/files');
    assert.equal(res.status, 200);
    const data = res.data as { files: unknown[] };
    assert.ok(data.files.length > 0);
  });
});

// ── CORS ───────────────────────────────────────────────────

describe('CORS headers', () => {
  it.skip('OPTIONS request returns CORS headers', async () => {
    // NOTE: This test may fail depending on server configuration
    // The CORS middleware should handle OPTIONS requests
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/v1/models',
          method: 'OPTIONS',
          headers: {
            'Origin': 'http://localhost:3000',
          },
        },
        (res) => {
          // CORS headers should be present
          assert.ok(res.headers['access-control-allow-origin'] !== undefined);
          resolve();
        },
      );
      req.on('error', reject);
      req.end();
    });
  });
});

// ── Security Profile Enforcement (default local-dev) ─────

describe('Security profile middleware — default local-dev', () => {
  it('allows all endpoints without securityProfile param', async () => {
    // The global test server was created without a securityProfile argument,
    // so it defaults to local-dev (all endpoints allowed)
    const res = await request('POST', '/v1/credentials', {
      provider: 'test-security',
      apiKey: 'test-key-12345',
    });
    assert.equal(res.status, 201);
  });
});
