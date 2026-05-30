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
import { createAllAdapters } from '../src/adapters/index.js';

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

for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

let server: http.Server;
let port = 0;

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
    hostname: 'localhost',
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
    };

    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.backendsScanned));
    assert.ok(body.backendsScanned.includes('ollama'));
    assert.ok(body.backendsScanned.includes('lm-studio'));
    assert.equal(typeof body.enrichedCount, 'number');
    assert.equal(typeof body.unenrichedCount, 'number');
  });

  it('accepts optional hfToken override', async () => {
    const res = await request('POST', '/v1/admin/discover', { hfToken: 'fake-token' });
    assert.equal(res.status, 200);
    const body = res.body as { ok: boolean };
    assert.equal(body.ok, true);
  });
});
