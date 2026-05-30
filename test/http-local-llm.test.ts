/**
 * HTTP local LLM endpoint tests — verify /v1/local/models.
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
const dbPath = `/tmp/test-http-local-llm-${Date.now()}.db`;

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

describe('GET /v1/local/models', () => {
  it('returns backends array with ollama and lm-studio', async () => {
    const res = await request('GET', '/v1/local/models');
    assert.equal(res.status, 200);
    const body = res.body as { backends: Array<{ backend: string; status: string; models: unknown[] }> };
    assert.ok(Array.isArray(body.backends));
    assert.equal(body.backends.length, 2);

    const backends = body.backends.map((b) => b.backend);
    assert.ok(backends.includes('ollama'));
    assert.ok(backends.includes('lm-studio'));
  });

  it('returns disconnected status when no local LLM is running', async () => {
    const res = await request('GET', '/v1/local/models');
    assert.equal(res.status, 200);
    const body = res.body as { backends: Array<{ backend: string; status: string }> };

    for (const backend of body.backends) {
      assert.ok(
        backend.status === 'disconnected' || backend.status === 'error',
        `Expected disconnected/error but got ${backend.status}`,
      );
    }
  });
});
