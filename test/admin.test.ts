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
import { SessionManager } from '../src/session/session-manager.js';
import {
  getCircuitBreakerRegistry,
  CircuitState,
} from '../src/core/circuit-breaker.js';
import { createDashboardJwt } from '../src/auth/github-oauth.js';
import { migrate } from '../src/db/migrate.js';

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
const sessionManager = new SessionManager({ ttlSeconds: 60, cleanupIntervalMs: 60_000 });

// Wire up router
router.setCostTracker(costTracker);
router.setSessionManager(sessionManager);

let server: http.Server;
let port = 0;

before(async () => {
  // Run migrations so model-sync tables exist
  await migrate({ dbPath });

  server = startHttpServer(
    router,
    vault,
    config,
    groupStore,
    costTracker,
    undefined,
    undefined,
    vault.getDb(),
    undefined,
    undefined,
    undefined,
    undefined,
    sessionManager,
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
      groupStore.close();
      costTracker.destroy();
      sessionManager.stopCleanup();
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

// ── GET /v1/admin/me ─────────────────────────────────────

describe('GET /v1/admin/me', () => {
  it('returns token auth identity when using static admin auth', async () => {
    const res = await request('GET', '/v1/admin/me');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, {
      authMethod: 'token',
      login: null,
      name: 'Admin',
      avatar: null,
    });
  });

  it('returns GitHub identity when using a valid dashboard JWT', async () => {
    process.env['GITHUB_OAUTH_SECRET'] = 'test-github-oauth-secret';
    const token = createDashboardJwt({
      id: 123,
      login: 'octocat',
      name: 'The Octocat',
      avatar_url: 'https://github.example/octocat.png',
    });

    try {
      const res = await request('GET', '/v1/admin/me', undefined, token);
      assert.equal(res.status, 200);
      assert.deepEqual(res.data, {
        authMethod: 'github',
        login: 'octocat',
        name: 'The Octocat',
        avatar: 'https://github.example/octocat.png',
      });
    } finally {
      delete process.env['GITHUB_OAUTH_SECRET'];
    }
  });
});

// ── GET /v1/admin/security-profile ───────────────────────

describe('GET /v1/admin/security-profile', () => {
  it('returns the default local-dev security shell payload', async () => {
    const res = await request('GET', '/v1/admin/security-profile');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, {
      profile: 'local-dev',
      allowedCategories: ['destructive', 'read', 'generate', 'admin'],
      rateLimit: null,
    });
  });
});

// ── GET /v1/admin/sessions ──────────────────────────────

describe('GET /v1/admin/sessions', () => {
  it('reports router sticky sessions separately from group sessions', async () => {
    sessionManager.pinRouterStickySession('admin-test-client', 'gpt-4o', 'openai', 'default', 10_000);
    const groupSession = sessionManager.getOrCreateSession(
      { apiKeyId: 4242, provider: 'anthropic', model: 'claude-3' },
      'anthropic',
      'key-admin-test',
      'claude-3',
    );

    try {
      const res = await request('GET', '/v1/admin/sessions');
      assert.equal(res.status, 200);

      const data = res.data as {
        note: string;
        routerStickySessions: { activeSessionCount: number; computedAt: number } | null;
        groupSessions: {
          activeSessionCount: number;
          averageSessionAge: number;
          byProvider: Array<{ provider: string; sessionCount: number; avgTtlRemaining: number }>;
          computedAt: number;
        } | null;
      };

      assert.match(data.note, /SessionManager/i);
      assert.ok(data.routerStickySessions, 'routerStickySessions should be present');
      assert.equal(data.routerStickySessions!.activeSessionCount, 1);
      assert.ok(data.routerStickySessions!.computedAt > 0);
      assert.ok(data.groupSessions, 'groupSessions should be present');
      assert.equal(data.groupSessions!.activeSessionCount, 1);
      assert.ok(data.groupSessions!.computedAt > 0);

      const anthropicEntry = data.groupSessions!.byProvider.find((entry) => entry.provider === 'anthropic');
      assert.ok(anthropicEntry);
      assert.equal(anthropicEntry!.sessionCount, 1);
    } finally {
      sessionManager.unpinRouterStickySession('admin-test-client', 'gpt-4o');
      sessionManager.endSession(groupSession.sessionId);
    }
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

// ── /v1/admin/keys ───────────────────────────────────────

describe('/v1/admin/keys', () => {
  it('creates, lists, and revokes API keys', async () => {
    const createRes = await request('POST', '/v1/admin/keys', {
      userId: 'admin-route-test-user',
      project: 'admin-route-test-project',
      budgetUsd: 25,
    });
    assert.equal(createRes.status, 201);

    const created = createRes.data as {
      ok: boolean;
      id: string;
      key: string;
      keyPrefix: string;
      userId: string;
      project: string | null;
      budgetUsd: number;
    };
    assert.equal(created.ok, true);
    assert.equal(created.userId, 'admin-route-test-user');
    assert.equal(created.project, 'admin-route-test-project');
    assert.equal(created.budgetUsd, 25);
    assert.ok(typeof created.id === 'string');
    assert.ok(typeof created.key === 'string');
    assert.ok(created.key.startsWith('mlb_sk_'));
    assert.ok(created.key.startsWith(created.keyPrefix));

    const listRes = await request('GET', '/v1/admin/keys?userId=admin-route-test-user');
    assert.equal(listRes.status, 200);

    const listData = listRes.data as {
      keys: Array<{
        id: string;
        keyPrefix: string;
        userId: string;
        project: string | null;
        budgetUsd: number;
        enabled: boolean;
        keyHash?: string;
      }>;
    };
    assert.ok(Array.isArray(listData.keys));
    assert.ok(listData.keys.length >= 1);
    const listed = listData.keys.find((key) => key.id === created.id);
    assert.ok(listed);
    assert.equal(listed!.keyPrefix, created.keyPrefix);
    assert.equal(listed!.userId, 'admin-route-test-user');
    assert.equal(listed!.project, 'admin-route-test-project');
    assert.equal(listed!.budgetUsd, 25);
    assert.equal(listed!.enabled, true);
    assert.equal('keyHash' in listed!, false);

    const revokeRes = await request('DELETE', `/v1/admin/keys/${created.id}`);
    assert.equal(revokeRes.status, 200);

    const revoked = revokeRes.data as { ok: boolean; id: string; message: string };
    assert.equal(revoked.ok, true);
    assert.equal(revoked.id, created.id);

    const listAfterRevokeRes = await request('GET', '/v1/admin/keys?userId=admin-route-test-user');
    assert.equal(listAfterRevokeRes.status, 200);

    const listAfterRevoke = listAfterRevokeRes.data as {
      keys: Array<{ id: string; enabled: boolean }>;
    };
    const revokedKey = listAfterRevoke.keys.find((key) => key.id === created.id);
    assert.ok(revokedKey);
    assert.equal(revokedKey!.enabled, false);
  });
});

// ── POST /v1/admin/models/sync ────────────────────────

function mockFetch(response: unknown): typeof fetch {
  return (async () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(response),
    } as Response)) as unknown as typeof fetch;
}

describe('POST /v1/admin/models/sync', () => {
  it('syncs models for a provider using vault credentials', async () => {
    // Store a credential in the vault for openai
    vault.store('openai', 'default', 'sk-test-openai-key');

    // Mock the upstream API response
    const originalFetch = global.fetch;
    global.fetch = mockFetch({
      data: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      ],
    }) as unknown as typeof fetch;

    try {
      const res = await request('POST', '/v1/admin/models/sync', {
        provider: 'openai',
      });

      assert.equal(res.status, 200);

      const data = res.data as {
        ok: boolean;
        provider: string;
        synced: number;
        models: Array<{ id: string; name: string }>;
        added: Array<{ id: string; name: string }>;
        removed: string[];
      };

      assert.equal(data.ok, true);
      assert.equal(data.provider, 'openai');
      assert.equal(data.synced, 2);
      assert.ok(Array.isArray(data.models));
      assert.ok(data.models.some((m) => m.id === 'gpt-4o'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('syncs models with explicit apiKey in body', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetch({
      models: [{ id: 'claude-3-opus' }],
    }) as unknown as typeof fetch;

    try {
      const res = await request('POST', '/v1/admin/models/sync', {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-test-anthropic-key',
      });

      assert.equal(res.status, 200);

      const data = res.data as {
        ok: boolean;
        provider: string;
        synced: number;
      };

      assert.equal(data.ok, true);
      assert.equal(data.provider, 'anthropic');
      assert.equal(data.synced, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('returns 400 for invalid provider', async () => {
    const res = await request('POST', '/v1/admin/models/sync', {
      provider: 'invalid-provider',
    });

    assert.equal(res.status, 400);

    const data = res.data as {
      error: string;
      code: string;
      details: { field: string; received: string; supportedProviders: string[] };
    };
    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.equal(data.error, 'Invalid provider for provider');
    assert.equal(data.details.field, 'provider');
    assert.equal(data.details.received, 'invalid-provider');
    assert.ok(Array.isArray(data.details.supportedProviders));
  });

  it('returns 400 when credentials are missing', async () => {
    const res = await request('POST', '/v1/admin/models/sync', {
      provider: 'groq',
    });

    assert.equal(res.status, 400);

    const data = res.data as { error: string; code: string };
    assert.equal(data.code, 'MISSING_CREDENTIALS');
  });
});

// ── GET /v1/admin/models/sync/history ───────────────────

describe('GET /v1/admin/models/sync/history', () => {
  it('returns sync history', async () => {
    // First sync something to create history
    vault.store('openai', 'default', 'sk-test-openai-key');

    const originalFetch = global.fetch;
    global.fetch = mockFetch({
      data: [{ id: 'gpt-4o' }],
    }) as unknown as typeof fetch;

    try {
      await request('POST', '/v1/admin/models/sync', {
        provider: 'openai',
      });

      const res = await request('GET', '/v1/admin/models/sync/history?provider=openai');
      assert.equal(res.status, 200);

      const data = res.data as {
        history: Array<{
          id: number;
          provider: string;
          modelsFound: number;
        }>;
        count: number;
      };

      assert.ok(Array.isArray(data.history));
      assert.ok(data.count > 0);
      assert.equal(data.history[0]!.provider, 'openai');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('returns 400 for invalid provider filter', async () => {
    const res = await request('GET', '/v1/admin/models/sync/history?provider=invalid-provider');
    assert.equal(res.status, 400);

    const data = res.data as {
      error: string;
      code: string;
      details: { field: string; received: string; supportedProviders: string[] };
    };

    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.equal(data.error, 'Invalid provider for provider');
    assert.equal(data.details.field, 'provider');
    assert.equal(data.details.received, 'invalid-provider');
    assert.ok(Array.isArray(data.details.supportedProviders));
  });

  it('returns 400 for invalid limit filter with clear error payload', async () => {
    const res = await request('GET', '/v1/admin/models/sync/history?limit=0');
    assert.equal(res.status, 400);

    const data = res.data as {
      error: string;
      code: string;
      details: { field: string; received: string; min: number; max: number };
    };

    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.equal(data.error, 'Invalid numeric value for limit');
    assert.deepEqual(data.details, {
      field: 'limit',
      received: '0',
      min: 1,
      max: 500,
    });
  });
});

// ── POST /v1/admin/prices/sync ───────────────────────────

describe('POST /v1/admin/prices/sync', () => {
  it('syncs prices successfully', async () => {
    const originalFetch = global.fetch;
    global.fetch = mockFetch({
      providers: {
        openai: {
          'gpt-4o': {
            name: 'GPT-4o',
            input: { price: 0.000005, currency: 'USD' },
            output: { price: 0.000015, currency: 'USD' },
          },
        },
      },
    }) as unknown as typeof fetch;

    try {
      const res = await request('POST', '/v1/admin/prices/sync');
      assert.equal(res.status, 200);

      const data = res.data as {
        ok: boolean;
        synced: number;
        details: { added: number; updated: number; unchanged: number; timestamp: number };
      };

      assert.equal(data.ok, true);
      assert.ok(data.synced >= 1);
      assert.ok(data.details.timestamp > 0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('returns 400 for invalid provider in body', async () => {
    const res = await request('POST', '/v1/admin/prices/sync', {
      provider: 'invalid-provider',
    });

    assert.equal(res.status, 400);

    const data = res.data as {
      error: string;
      code: string;
      details: { field: string; received: string; supportedProviders: string[] };
    };

    assert.equal(data.code, 'VALIDATION_ERROR');
    assert.equal(data.error, 'Invalid provider for provider parameter');
    assert.equal(data.details.field, 'provider');
    assert.equal(data.details.received, 'invalid-provider');
    assert.ok(Array.isArray(data.details.supportedProviders));
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
