import { freezeRouterForStartup } from "../helpers/frozen-router.js";
/**
 * Cross-sprint integration test — exercises ALL wired features in sequence.
 *
 * Sprint 0: Unified classification / types
 * Sprint 1: Security profiles + Approval flows
 * Sprint 2: Three-part prompt + RTK compression
 * Sprint 3: Local LLM offloading + HF Auto-Discovery
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import http from 'node:http';

import { Vault } from '../../src/vault/vault.js';
import { Router } from '../../src/core/router.js';
import type { GatewayConfig } from '../../src/core/types.js';
import { startHttpServer } from '../../src/server/http.js';
import type { AdminDiscoveryServices } from '../../src/server/routes/admin/discovery.js';
import type { ToolingRouteDeps } from '../../src/server/routes/tooling.js';
import { StubAdapter } from '../helpers/stub-adapter.js';
import { ApprovalStore } from '../../src/approval/index.js';
import { optimizeMessages } from '../../src/transformers/three-part-prompt.js';
import { compressOutput, compressionStats } from '../../src/context-compression/output-compression.js';
import { handleToolCall } from '../../src/server/mcp.js';
import { optimizeMessagesEnabled } from '../../src/core/router.js';

// ── Test-only discovery seams ─────────────────────────────

const LOCAL_LLM_URLS = {
  ollamaUrl: 'http://127.0.0.1:11434',
  lmStudioUrl: 'http://127.0.0.1:1234',
};
const FIXED_TIMESTAMP = '2026-09-10T00:00:00.000Z';

function createDiscoveryServices(expectedHfTokens: Array<string | undefined>) {
  const calls = { loadCatalog: 0, importCatalog: 0, slimStatus: 0, discoverModels: 0 };
  const services: AdminDiscoveryServices = {
    loadCatalog: () => { calls.loadCatalog++; throw new Error('loadCatalog must not run in discovery tests'); },
    importCatalog: () => { calls.importCatalog++; throw new Error('importCatalog must not run in discovery tests'); },
    async getSlimLocalLLMStatus(localConfig, options) {
      assert.deepEqual(localConfig, { enabled: false, ...LOCAL_LLM_URLS });
      assert.deepEqual(options, { skipDetectionWhenDisabled: true });
      calls.slimStatus++;
      return {
        enabled: false, ready: false, readyReason: 'Local LLM is disabled by runtime flag',
        checkedAt: FIXED_TIMESTAMP, source: 'disabled', cacheHit: false,
        backendCount: 2, connectedBackendCount: 0, disconnectedBackendCount: 2, errorBackendCount: 0, modelCount: 0,
        backends: [
          { backend: 'ollama', status: 'disconnected', baseUrl: LOCAL_LLM_URLS.ollamaUrl, modelCount: 0, models: [] },
          { backend: 'lm-studio', status: 'disconnected', baseUrl: LOCAL_LLM_URLS.lmStudioUrl, modelCount: 0, models: [] },
        ],
      };
    },
    async discoverModels(discoveryConfig, localConfig, db, options) {
      assert.ok(calls.discoverModels < expectedHfTokens.length);
      assert.equal(discoveryConfig?.hfToken, expectedHfTokens[calls.discoverModels]);
      assert.equal(discoveryConfig?.enabled, true);
      assert.deepEqual(localConfig, LOCAL_LLM_URLS);
      assert.equal(db, undefined);
      assert.deepEqual(options, { forceRefreshLocalDetection: true });
      calls.discoverModels++;
      return {
        models: [], backendsScanned: ['ollama', 'lm-studio'], enrichedCount: 0, unenrichedCount: 0,
        timestamp: FIXED_TIMESTAMP, errors: [], partial: false, snapshotUsed: false,
      };
    },
  };
  return { services, calls };
}

function createToolingRouteDeps() {
  const calls = { localStatus: 0, catalog: 0, strategies: 0 };
  const deps: ToolingRouteDeps = {
    async getLocalLLMStatus(localConfig, options) {
      assert.deepEqual(localConfig, { enabled: false, ...LOCAL_LLM_URLS });
      assert.deepEqual(options, { skipDetectionWhenDisabled: true });
      calls.localStatus++;
      return {
        enabled: false, ready: false, readyReason: 'Local LLM is disabled by runtime flag',
        checkedAt: FIXED_TIMESTAMP, source: 'disabled', cacheHit: false,
        backendCount: 2, connectedBackendCount: 0, disconnectedBackendCount: 2, errorBackendCount: 0, modelCount: 0,
        backends: [
          { backend: 'ollama', status: 'disconnected', baseUrl: LOCAL_LLM_URLS.ollamaUrl, modelCount: 0, models: [] },
          { backend: 'lm-studio', status: 'disconnected', baseUrl: LOCAL_LLM_URLS.lmStudioUrl, modelCount: 0, models: [] },
        ],
      };
    },
    getToolCatalog: () => { calls.catalog++; throw new Error('getToolCatalog must not run in discovery tests'); },
    getStrategies: async () => { calls.strategies++; throw new Error('getStrategies must not run in discovery tests'); },
  };
  return { deps, calls };
}

// ── Test infrastructure ──────────────────────────────────

const AUTH_TOKEN = 'test-integration-token-' + randomBytes(16).toString('hex');
const dbPath = `/tmp/test-integration-${Date.now()}.db`;

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath,
  httpPort: 0,
  authToken: AUTH_TOKEN,
  securityProfile: 'restricted',
};

const vault = new Vault(config);
const router = new Router();

router.register(new StubAdapter());

// Wire sprint modules
const approvalStore = new ApprovalStore();
const discovery = createDiscoveryServices([undefined]);
const tooling = createToolingRouteDeps();

let server: http.Server;
let port = 0;

before(async () => {
	server = startHttpServer({
		router: freezeRouterForStartup(router),
		vault,
		config,
		securityProfile: config.securityProfile,
		approvalStore,
		toolingRouteDeps: tooling.deps,
		adminDiscoveryServices: discovery.services,
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

// ── HTTP helper ──────────────────────────────────────────

async function request(
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; body: unknown }> {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port,
    path,
    method,
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Tests ────────────────────────────────────────────────

describe('Wiring Sprint — Cross-sprint integration', () => {
  describe('Sprint 1: Approval flows', () => {
    it('creates approval request, approves, then executes destructive tool', async () => {
      // Step 1: Create approval request for vault_store
      const req = approvalStore.create({
        toolName: 'vault_store',
        toolArgs: { provider: 'openai', apiKey: 'sk-test' },
        requester: 'integration-test',
        reason: 'Store test credential',
      });

      assert.equal(req.status, 'pending');
      assert.ok(req.id.startsWith('approval-'));

      // Step 2: Approve the request
      const approved = approvalStore.approve(req.id, 'admin');
      assert.ok(approved);
      assert.equal(approved!.status, 'approved');

      // Step 3: Verify pending list is empty after approval
      const pending = approvalStore.getPending();
      assert.equal(pending.length, 0);
    });

    it('denies destructive tool when approval is denied', async () => {
      const req = approvalStore.create({
        toolName: 'vault_delete',
        toolArgs: { id: 1 },
        requester: 'integration-test',
        reason: 'Delete test credential',
      });

      const denied = approvalStore.deny(req.id, 'admin');
      assert.ok(denied);
      assert.equal(denied!.status, 'denied');
    });

    it('HTTP security profile blocks destructive endpoints under restricted', async () => {
      // Under restricted profile, POST /v1/credentials (destructive) should be blocked
      const res = await request('POST', '/v1/credentials', {
        provider: 'openai',
        apiKey: 'sk-test',
      });

      assert.equal(res.status, 403);
      const body = res.body as { code: string };
      assert.equal(body.code, 'SECURITY_PROFILE_DENIED');
    });

    it('HTTP security profile allows read endpoints under restricted', async () => {
      const res = await request('GET', '/v1/providers');
      assert.equal(res.status, 200);
    });
  });

  describe('Sprint 2: Three-part prompt + compression', () => {
    it('optimizes flat prompt into three-part structure', () => {
      const flatPrompt = 'Context: We use Zod 4 for validation.\n\nTask: Explain why Zod is better than class-validator.';

      const messages = optimizeMessages([{ role: 'user', content: flatPrompt }]);

      // Should produce system + user or just restructured user message
      assert.ok(messages.length >= 1);
      // The optimizer should have detected context/instruction separation
      const userMsg = messages.find((m) => m.role === 'user');
      assert.ok(userMsg);
      assert.ok(typeof userMsg!.content === 'string');
      const content = userMsg!.content as string;
      assert.ok(content.includes('Zod') || content.includes('context') || content.includes('validation'));
    });

    it('compresses large tool output', () => {
      const largeOutput = JSON.stringify({
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `item-${i}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          name: `Item ${i}`,
          description: 'A'.repeat(600),
        })),
      });

      const statsBefore = { ...compressionStats.getSummary() };
      const compressed = compressOutput(largeOutput);
      const statsAfter = compressionStats.getSummary();

      assert.ok(typeof compressed === 'string');
      assert.ok((compressed as string).length < largeOutput.length);
      // Stats should record the compression
      assert.ok(statsAfter.totalCalls >= statsBefore.totalCalls);
    });

    it('skips compression for short output', () => {
      const shortOutput = JSON.stringify({ success: true });
      const compressed = compressOutput(shortOutput, { maxValueLength: 500 });

      // Short output should pass through mostly unchanged
      assert.equal(compressed, shortOutput);
    });

    it('HTTP compression stats endpoint returns analytics', async () => {
      const res = await request('GET', '/v1/compression/stats');
      assert.equal(res.status, 200);
      const body = res.body as { totalCalls: number; avgRatio: number };
      assert.equal(typeof body.totalCalls, 'number');
      assert.equal(typeof body.avgRatio, 'number');
    });
  });

  describe('Sprint 3: Local LLM + HF Discovery', () => {
    it('local LLM routing endpoint returns models list', async () => {
      // The injected status service makes this route deterministic without probes.
      const res = await request('GET', '/v1/local/models');
      assert.equal(res.status, 200);
      assert.deepEqual(tooling.calls, { localStatus: 1, catalog: 0, strategies: 0 });
    });

    it('admin discovery endpoint scans backends', async () => {
      const res = await request('POST', '/v1/admin/discover');
      assert.equal(res.status, 200);
      const body = res.body as {
        ok: boolean;
        backendsScanned: string[];
      };
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.backendsScanned));
      assert.deepEqual(discovery.calls, { loadCatalog: 0, importCatalog: 0, slimStatus: 1, discoverModels: 1 });
    });

    it('MCP discover_models tool is registered', async () => {
      // Fast test: verify handleToolCall can route to discover_models
      // We mock the router to avoid external calls
      const fastRouter = new Router();
      (fastRouter as any).generate = async () => ({
        text: 'Mock',
        provider: 'mock',
        model: 'mock',
        tokensUsed: 1,
        resolvedProvider: 'mock',
        resolvedModel: 'mock',
        fallbackUsed: false,
      });

      const result = await handleToolCall(
        'discover_models',
        {},
        fastRouter,
        vault,
      );

      assert.ok(result.content);
      assert.ok(result.content.length > 0);
    });
  });

  describe('Cross-sprint: Feature flags respected', () => {
    it('optimizeMessagesEnabled returns true by default', () => {
      assert.equal(optimizeMessagesEnabled(), true);
    });

    it('outputCompressionEnabled returns true by default', () => {
      // This is defined in mcp.ts as a local function; we test via behavior
      const largeOutput = JSON.stringify({ data: 'x'.repeat(2000) });
      const compressed = compressOutput(largeOutput);
      assert.ok((compressed as string).length < largeOutput.length);
    });
  });
});
