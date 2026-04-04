/**
 * Cost estimation endpoint tests — GET /v1/cost/estimate and GET /v1/cost/models.
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

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-http-cost-${Date.now()}.db`,
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

/** Helper to make HTTP requests. */
async function request(
  method: string,
  path: string,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
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
    req.end();
  });
}

// ── GET /v1/cost/estimate ───────────────────────────────

describe('GET /v1/cost/estimate', () => {
  it('returns valid cost estimate for known model', async () => {
    const res = await request(
      'GET',
      '/v1/cost/estimate?model=gpt-4o&inputTokens=1000&outputTokens=500',
    );
    assert.equal(res.status, 200);

    const data = res.data as {
      model: string;
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
      pricePerMTok: { input: number; output: number };
      currency: string;
    };

    assert.equal(data.model, 'gpt-4o');
    assert.equal(data.inputTokens, 1000);
    assert.equal(data.outputTokens, 500);
    assert.equal(data.currency, 'USD');
    assert.equal(data.pricePerMTok.input, 2.50);
    assert.equal(data.pricePerMTok.output, 10.00);

    // gpt-4o: (1000/1M) * 2.50 + (500/1M) * 10.00
    const expected = (1000 / 1_000_000) * 2.50 + (500 / 1_000_000) * 10.00;
    assert.equal(data.estimatedCost, expected);
  });

  it('returns 400 for unknown model', async () => {
    const res = await request(
      'GET',
      '/v1/cost/estimate?model=unknown-model-xyz&inputTokens=1000&outputTokens=500',
    );
    assert.equal(res.status, 400);

    const data = res.data as { error: string };
    assert.equal(data.error, 'Unknown model');
  });

  it('returns 400 when model param is missing', async () => {
    const res = await request(
      'GET',
      '/v1/cost/estimate?inputTokens=1000&outputTokens=500',
    );
    assert.equal(res.status, 400);

    const data = res.data as { error: string };
    assert.equal(data.error, 'Validation error');
  });

  it('returns 400 for negative token counts', async () => {
    const res = await request(
      'GET',
      '/v1/cost/estimate?model=gpt-4o&inputTokens=-100&outputTokens=500',
    );
    assert.equal(res.status, 400);

    const data = res.data as { error: string };
    assert.equal(data.error, 'Validation error');
  });
});

// ── GET /v1/cost/models ─────────────────────────────────

describe('GET /v1/cost/models', () => {
  it('returns full pricing table as JSON object', async () => {
    const res = await request('GET', '/v1/cost/models');
    assert.equal(res.status, 200);

    const data = res.data as Record<string, { inputPerMTok: number; outputPerMTok: number }>;

    // Should have many models
    assert.ok(Object.keys(data).length > 10, 'should have many models');

    // Spot check a known model
    assert.ok(data['gpt-4o'], 'should contain gpt-4o');
    assert.equal(data['gpt-4o'].inputPerMTok, 2.50);
    assert.equal(data['gpt-4o'].outputPerMTok, 10.00);
  });
});
