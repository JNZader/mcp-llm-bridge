import { freezeRouterForStartup } from "./helpers/frozen-router.js";
/**
 * Admin discovery endpoint tests — verify POST /v1/admin/discover.
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
import type { AdminDiscoveryServices } from '../src/server/routes/admin/discovery.js';
import { StubAdapter } from './helpers/stub-adapter.js';

// ── Test-only discovery seams ─────────────────────────────

const LOCAL_LLM_URLS = {
  ollamaUrl: 'http://localhost:11434',
  lmStudioUrl: 'http://localhost:1234',
};
const FIXED_TIMESTAMP = '2026-09-10T00:00:00.000Z';

function createDiscoveryServices(expectedHfTokens: Array<string | undefined>) {
  const calls = { loadCatalog: 0, importCatalog: 0, slimStatus: 0, discoverModels: 0 };
  const services: AdminDiscoveryServices = {
    loadCatalog: () => {
      calls.loadCatalog++;
      throw new Error('loadCatalog must not run in discovery tests');
    },
    importCatalog: () => {
      calls.importCatalog++;
      throw new Error('importCatalog must not run in discovery tests');
    },
    async getSlimLocalLLMStatus(localConfig, options) {
      assert.deepEqual(localConfig, { enabled: false, ...LOCAL_LLM_URLS });
      assert.deepEqual(options, { skipDetectionWhenDisabled: true });
      calls.slimStatus++;
      return {
        enabled: false, ready: false, readyReason: 'Local LLM is disabled by runtime flag',
        checkedAt: FIXED_TIMESTAMP, source: 'disabled', cacheHit: false,
        backendCount: 2, connectedBackendCount: 0, disconnectedBackendCount: 2,
        errorBackendCount: 0, modelCount: 0,
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

// ── Test infrastructure ──────────────────────────────────

const AUTH_TOKEN = 'test-auth-token-' + randomBytes(16).toString('hex');
const dbPath = `/tmp/test-admin-discovery-${Date.now()}.db`;

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath,
  httpPort: 0,
  authToken: AUTH_TOKEN,
};

const vault = new Vault(config);
const router = new Router();

router.register(new StubAdapter());

let server: http.Server;
let port = 0;
const discovery = createDiscoveryServices([undefined, 'fake-token']);

before(async () => {
  delete process.env['HF_TOKEN'];
  server = startHttpServer({
    router: freezeRouterForStartup(router), vault, config,
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

describe('POST /v1/admin/discover', () => {
  it('returns discovery result with backends scanned', async () => {
    const res = await request('POST', '/v1/admin/discover');
    assert.equal(res.status, 200);
    const body = res.body as {
      ok: boolean;
      backendsScanned: string[];
      models: unknown[];
      enrichedCount: number;
      unenrichedCount: number;
      partial: boolean;
      snapshotUsed: boolean;
      localLLMStatus: {
        enabled: boolean;
        ready: boolean;
        checkedAt: string;
        backends: Array<{
          backend: string;
          status: string;
          baseUrl: string;
          modelCount: number;
        }>;
      };
    };

    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.backendsScanned));
    assert.ok(body.backendsScanned.includes('ollama'));
    assert.ok(body.backendsScanned.includes('lm-studio'));
    assert.equal(typeof body.enrichedCount, 'number');
    assert.equal(typeof body.unenrichedCount, 'number');
    assert.equal(typeof body.partial, 'boolean');
    assert.equal(typeof body.snapshotUsed, 'boolean');
    assert.equal(typeof body.localLLMStatus.enabled, 'boolean');
    assert.equal(typeof body.localLLMStatus.ready, 'boolean');
    assert.equal(typeof body.localLLMStatus.checkedAt, 'string');
    assert.ok(Array.isArray(body.localLLMStatus.backends));
    assert.ok(body.localLLMStatus.backends.length >= 2);
    assert.equal(typeof body.localLLMStatus.backends[0]?.modelCount, 'number');
    assert.deepEqual(discovery.calls, { loadCatalog: 0, importCatalog: 0, slimStatus: 1, discoverModels: 1 });
  });

  it('accepts optional hfToken override', async () => {
    const res = await request('POST', '/v1/admin/discover', { hfToken: 'fake-token' });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean };
    assert.equal(body.ok, true);
    assert.deepEqual(discovery.calls, { loadCatalog: 0, importCatalog: 0, slimStatus: 2, discoverModels: 2 });
  });
});
