/**
 * HTTP middleware tests — body size limit, timeout, auth, and CORS.
 *
 * Spins up a real Hono server with the full middleware stack
 * to verify each middleware layer in isolation.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import http from 'node:http';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import type { GatewayConfig } from '../src/core/types.js';
import { startHttpServer } from '../src/server/http.js';
import { createAllAdapters } from '../src/adapters/index.js';

// ── Shared setup — server WITH auth token ───────────────────

const AUTH_TOKEN = 'test-secret-token-1234';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-http-mw-${Date.now()}.db`,
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
        if (existsSync(filePath)) unlinkSync(filePath);
      }
      resolve();
    });
  });
});

// ── HTTP helper (supports custom headers) ───────────────────

interface RequestOptions {
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
}

async function req(opts: RequestOptions): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => unknown;
}> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...opts.headers,
    };
    if (opts.body && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(opts.body));
    }

    const r = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: opts.path,
        method: opts.method,
        headers: { ...reqHeaders, 'Connection': 'close' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: data,
            json: () => {
              try {
                return JSON.parse(data);
              } catch {
                return {};
              }
            },
          });
        });
      },
    );
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

// ── Body size limit (413) ──────────────────────────────────

describe('bodySizeLimit middleware', () => {
  it('returns 413 when Content-Length exceeds MAX_BODY_SIZE', async () => {
    // MAX_BODY_SIZE is 1_000_000 bytes — send a body with a spoofed Content-Length header
    const smallBody = '{"prompt":"x"}';
    const res = await req({
      method: 'POST',
      path: '/v1/generate',
      headers: {
        'Content-Length': '2000000',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: smallBody,
    });

    assert.equal(res.status, 413);
    const data = res.json() as { code: string };
    assert.equal(data.code, 'PAYLOAD_TOO_LARGE');
  });

  it('allows requests under the size limit', async () => {
    const res = await req({
      method: 'POST',
      path: '/v1/credentials',
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-test-small' }),
    });

    // Should NOT be 413 — credentials endpoint works without provider calls
    assert.notEqual(res.status, 413);
    assert.equal(res.status, 201);
  });
});

// ── Auth middleware ─────────────────────────────────────────

describe('bearerAuth middleware', () => {
  it('GET /health passes without auth (health check bypass)', async () => {
    const res = await req({ method: 'GET', path: '/health' });
    assert.equal(res.status, 200);
  });

  it('rejects requests without Authorization header', async () => {
    const res = await req({ method: 'GET', path: '/v1/models' });
    assert.equal(res.status, 401);
  });

  it('rejects requests with invalid bearer token', async () => {
    const res = await req({
      method: 'GET',
      path: '/v1/models',
      headers: { 'Authorization': 'Bearer wrong-token' },
    });
    assert.equal(res.status, 401);
  });

  it('rejects malformed Authorization header (no Bearer prefix)', async () => {
    const res = await req({
      method: 'GET',
      path: '/v1/models',
      headers: { 'Authorization': 'Basic dXNlcjpwYXNz' },
    });
    assert.equal(res.status, 401);
  });

  it('accepts requests with valid bearer token', async () => {
    const res = await req({
      method: 'GET',
      path: '/v1/models',
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
    });
    assert.equal(res.status, 200);
  });

  it('OPTIONS requests pass through (CORS preflight)', async () => {
    const res = await req({
      method: 'OPTIONS',
      path: '/v1/models',
      headers: { 'Origin': 'http://localhost:3000' },
    });
    // OPTIONS should not get 401
    assert.notEqual(res.status, 401);
  });
});

// ── CORS headers ───────────────────────────────────────────

describe('CORS middleware', () => {
  it('sets Access-Control-Allow-Origin on responses', async () => {
    const res = await req({
      method: 'GET',
      path: '/health',
      headers: { 'Origin': 'https://gateway.javierzader.com' },
    });

    assert.ok(
      res.headers['access-control-allow-origin'] !== undefined,
      'Response should include Access-Control-Allow-Origin header',
    );
  });

  it('includes expected allowed methods in preflight response', async () => {
    const res = await req({
      method: 'OPTIONS',
      path: '/v1/models',
      headers: {
        'Origin': 'https://gateway.javierzader.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    const allowMethods = res.headers['access-control-allow-methods'];
    assert.ok(allowMethods, 'Should have Access-Control-Allow-Methods');
    assert.ok(
      String(allowMethods).includes('POST'),
      'POST should be in allowed methods',
    );
  });
});

// ── Correlation ID ─────────────────────────────────────────

describe('correlationId middleware', () => {
  it('generates a correlation ID when none is provided', async () => {
    const res = await req({ method: 'GET', path: '/health' });
    const corrId = res.headers['x-correlation-id'];

    assert.ok(corrId, 'Should return X-Correlation-ID header');
    assert.ok(
      String(corrId).match(/^[0-9a-f-]{36}$/),
      'Should be a UUID format',
    );
  });

  it('echoes back a provided correlation ID', async () => {
    const customId = 'my-trace-id-123';
    const res = await req({
      method: 'GET',
      path: '/health',
      headers: { 'X-Correlation-ID': customId },
    });

    assert.equal(res.headers['x-correlation-id'], customId);
  });
});
