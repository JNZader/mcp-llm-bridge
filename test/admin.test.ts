/**
 * Admin API endpoint tests — verify /v1/admin/* routes.
 *
 * Tests cover:
 * - GET /v1/admin/overview — unified dashboard shape
 * - GET /v1/admin/providers — detailed provider list
 * - GET /v1/admin/health — extended health check
 * - POST /v1/admin/reset-circuit-breaker/:provider — breaker reset
 * - POST /v1/admin/flush-usage — force flush
 * - Auth enforcement: missing/invalid tokens → 401
 * - ADMIN_TOKEN precedence over AUTH_TOKEN
 */

import { describe, it, after, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import http from 'node:http';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import type { GatewayConfig } from '../src/core/types.js';
import { startHttpServer } from '../src/server/http.js';
import { createAllAdapters } from '../src/adapters/index.js';
import { GroupStore } from '../src/core/groups.js';
import { CostTracker } from '../src/core/cost-tracker.js';
import {
  getCircuitBreakerRegistry,
  resetCircuitBreakerRegistry,
  CircuitState,
} from '../src/core/circuit-breaker.js';

// ── Test infrastructure ──────────────────────────────────

const AUTH_TOKEN = 'test-auth-token-' + randomBytes(16).toString('hex');
const dbPath = `/tmp/test-admin-${Date.now()}.db`;

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath,
  httpPort: 0,
  authToken: AUTH_TOKEN,
};

const vault = new Vault(config);
const router = new Router();

for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

const groupStore = new GroupStore(dbPath);
const costTracker = new CostTracker({ dbPath });

// Wire up router
router.setCostTracker(costTracker);

let server: http.Server;
let port = 0;

before(async () => {
  server = startHttpServer(router, vault, config, groupStore, costTracker) as unknown as http.Server;
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
      groupStore.close();
      costTracker.destroy();
      for (const suffix of ['', '-wal', '-shm']) {
        const filePath = dbPath + suffix;
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      }
      resolve();
    });
  });
});

afterEach(() => {
  // Clean up environment variables between tests
  delete process.env['ADMIN_TOKEN'];
});

// ── HTTP helper ──────────────────────────────────────────

async function request(
  method: string,
  path: string,
  body?: object,
  token?: string | null,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (bodyStr) {
      headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }
    // token=null means explicitly no auth; token=undefined means use default
    if (token !== null) {
      headers['Authorization'] = `Bearer ${token ?? AUTH_TOKEN}`;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
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

// ── GET /v1/admin/overview ──────────────────────────────

describe('GET /v1/admin/overview', () => {
  it('returns expected shape with all sections', async () => {
    const res = await request('GET', '/v1/admin/overview');
    assert.equal(res.status, 200);

    const data = res.data as {
      providers: Array<{ id: string; name: string; type: string; available: boolean }>;
      groups: Array<{ id: string; name: string; memberCount: number }>;
      circuitBreakers: { total: number; open: number; closed: number; halfOpen: number };
      usage: { totalRequests: number; totalCost: number; totalTokens: number };
      system: { uptime: number; version: string; mode: string };
    };

    // Providers section
    assert.ok(Array.isArray(data.providers), 'providers should be an array');

    // Groups section
    assert.ok(Array.isArray(data.groups), 'groups should be an array');

    // Circuit breakers section
    assert.ok(typeof data.circuitBreakers.total === 'number');
    assert.ok(typeof data.circuitBreakers.open === 'number');
    assert.ok(typeof data.circuitBreakers.closed === 'number');
    assert.ok(typeof data.circuitBreakers.halfOpen === 'number');

    // Usage section
    assert.ok(typeof data.usage.totalRequests === 'number');
    assert.ok(typeof data.usage.totalCost === 'number');
    assert.ok(typeof data.usage.totalTokens === 'number');

    // System section
    assert.ok(typeof data.system.uptime === 'number');
    assert.ok(data.system.uptime >= 0);
    assert.ok(typeof data.system.version === 'string');
    assert.ok(typeof data.system.mode === 'string');
  });

  it('providers include availability status', async () => {
    const res = await request('GET', '/v1/admin/overview');
    const data = res.data as {
      providers: Array<{ id: string; available: boolean }>;
    };

    if (data.providers.length > 0) {
      const provider = data.providers[0]!;
      assert.ok(typeof provider.id === 'string');
      assert.ok(typeof provider.available === 'boolean');
    }
  });
});

// ── GET /v1/admin/providers ─────────────────────────────

describe('GET /v1/admin/providers', () => {
  it('lists all adapters with details', async () => {
    const res = await request('GET', '/v1/admin/providers');
    assert.equal(res.status, 200);

    const data = res.data as {
      providers: Array<{
        id: string;
        name: string;
        type: string;
        available: boolean;
        models: string[];
        circuitBreaker: { state: string; failures: number };
      }>;
    };

    assert.ok(Array.isArray(data.providers));
    assert.ok(data.providers.length > 0, 'should have at least one provider');

    const first = data.providers[0]!;
    assert.ok(typeof first.id === 'string');
    assert.ok(typeof first.name === 'string');
    assert.ok(typeof first.type === 'string');
    assert.ok(typeof first.available === 'boolean');
    assert.ok(Array.isArray(first.models));
    assert.ok(typeof first.circuitBreaker === 'object');
    assert.ok(typeof first.circuitBreaker.state === 'string');
  });
});

// ── GET /v1/admin/health ────────────────────────────────

describe('GET /v1/admin/health', () => {
  it('returns db/provider status and memory', async () => {
    const res = await request('GET', '/v1/admin/health');
    assert.equal(res.status, 200);

    const data = res.data as {
      status: string;
      database: { connected: boolean };
      providers: { available: number; total: number };
      uptime: number;
      version: string;
      memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
    };

    assert.equal(data.status, 'ok');
    assert.equal(data.database.connected, true);
    assert.ok(typeof data.providers.available === 'number');
    assert.ok(typeof data.providers.total === 'number');
    assert.ok(data.providers.total >= data.providers.available);
    assert.ok(typeof data.uptime === 'number');
    assert.ok(data.uptime >= 0);
    assert.ok(typeof data.version === 'string');

    // Memory usage
    assert.ok(typeof data.memory.rss === 'number');
    assert.ok(data.memory.rss > 0);
    assert.ok(typeof data.memory.heapTotal === 'number');
    assert.ok(typeof data.memory.heapUsed === 'number');
    assert.ok(typeof data.memory.external === 'number');
  });
});

// ── POST /v1/admin/reset-circuit-breaker ────────────────

describe('POST /v1/admin/reset-circuit-breaker/:provider', () => {
  it('resets a circuit breaker', async () => {
    // Trip a breaker first
    const cbRegistry = getCircuitBreakerRegistry();
    const breaker = cbRegistry.get('test-provider-reset');
    // Force to OPEN state
    breaker.forceState(CircuitState.OPEN);
    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Reset via API
    const res = await request('POST', '/v1/admin/reset-circuit-breaker/test-provider-reset');
    assert.equal(res.status, 200);

    const data = res.data as { ok: boolean; provider: string; state: string };
    assert.equal(data.ok, true);
    assert.equal(data.provider, 'test-provider-reset');
    assert.equal(data.state, 'CLOSED');

    // Verify it's actually reset
    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });

  it('returns 404 for unknown provider', async () => {
    const res = await request('POST', '/v1/admin/reset-circuit-breaker/nonexistent-provider-xyz');
    assert.equal(res.status, 404);

    const data = res.data as { error: string; code: string };
    assert.equal(data.code, 'NOT_FOUND');
  });
});

// ── POST /v1/admin/flush-usage ──────────────────────────

describe('POST /v1/admin/flush-usage', () => {
  it('triggers cost tracker flush', async () => {
    // Add a record to the buffer
    costTracker.record({
      provider: 'test',
      model: 'test-model',
      tokensIn: 100,
      tokensOut: 50,
      latencyMs: 200,
      success: true,
    });
    assert.ok(costTracker.bufferSize > 0, 'buffer should have entries');

    const res = await request('POST', '/v1/admin/flush-usage');
    assert.equal(res.status, 200);

    const data = res.data as { ok: boolean; flushed: number; remainingBuffer: number };
    assert.equal(data.ok, true);
    assert.ok(data.flushed > 0, 'should have flushed at least one record');
    assert.equal(data.remainingBuffer, 0);
  });
});

// ── Auth enforcement ────────────────────────────────────

describe('Admin auth', () => {
  it('rejects request without token', async () => {
    const res = await request('GET', '/v1/admin/overview', undefined, null);
    assert.equal(res.status, 401);
    const data = res.data as { error: string };
    assert.equal(data.error, 'Unauthorized');
  });

  it('rejects request with invalid token', async () => {
    const res = await request('GET', '/v1/admin/overview', undefined, 'wrong-token');
    assert.equal(res.status, 401);
  });

  it('accepts request with valid AUTH_TOKEN', async () => {
    const res = await request('GET', '/v1/admin/overview', undefined, AUTH_TOKEN);
    assert.equal(res.status, 200);
  });

  it('ADMIN_TOKEN takes precedence when set', async () => {
    const adminToken = 'admin-only-' + randomBytes(16).toString('hex');
    process.env['ADMIN_TOKEN'] = adminToken;

    // Regular AUTH_TOKEN should now be rejected for admin routes
    // Note: The middleware reads ADMIN_TOKEN at request time
    const res = await request('GET', '/v1/admin/health', undefined, AUTH_TOKEN);
    assert.equal(res.status, 401, 'Regular token should be rejected when ADMIN_TOKEN is set');

    // ADMIN_TOKEN should work
    const res2 = await request('GET', '/v1/admin/health', undefined, adminToken);
    assert.equal(res2.status, 200, 'Admin token should be accepted');
  });
});
