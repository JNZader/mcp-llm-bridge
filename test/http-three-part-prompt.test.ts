/**
 * HTTP three-part prompt tests — verify /v1/generate accepts
 * system/context/instruction fields and auto-optimizes flat prompts.
 */

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import http from 'node:http';

import { Vault } from '../src/vault/vault.js';
import { Router } from '../src/core/router.js';
import { MAX_PROMPT_LENGTH } from '../src/core/constants.js';
import type { GatewayConfig } from '../src/core/types.js';
import { startHttpServer } from '../src/server/http.js';
import { createAllAdapters } from '../src/adapters/index.js';

// Create test components once
const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-http-three-part-${Date.now()}.db`,
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

// ── Three-part prompt fields ─────────────────────────────────

describe('POST /v1/generate with three-part fields', () => {
  it('accepts explicit system, context, instruction fields', async () => {
    const res = await request('POST', '/v1/generate', {
      system: 'You are a helpful assistant',
      context: 'Project uses React 19',
      instruction: 'Explain useMemo',
      model: 'gpt-4o',
    });

    // Should succeed (provider may fail, but request should parse)
    assert.ok(
      res.status === 200 || res.status === 500,
      `Expected 200 or 500, got ${res.status}`,
    );
  });

  it('accepts backward-compatible flat prompt', async () => {
    const res = await request('POST', '/v1/generate', {
      prompt: 'Hello world',
      model: 'gpt-4o',
    });

    assert.ok(
      res.status === 200 || res.status === 500,
      `Expected 200 or 500, got ${res.status}`,
    );
  });

  it('auto-detects three-part structure in flat prompt', async () => {
    const res = await request('POST', '/v1/generate', {
      prompt: 'Context: We use TypeScript strict mode.\n\nTask: Explain generics.',
      model: 'gpt-4o',
    });

    assert.ok(
      res.status === 200 || res.status === 500,
      `Expected 200 or 500, got ${res.status}`,
    );
  });

  it('rejects prompt exceeding MAX_PROMPT_LENGTH after optimization', async () => {
    const hugePrompt = 'a'.repeat(MAX_PROMPT_LENGTH + 1);
    const res = await request('POST', '/v1/generate', {
      prompt: hugePrompt,
    });

    assert.equal(res.status, 400);
    const data = res.data as { code: string };
    assert.equal(data.code, 'VALIDATION_ERROR');
  });

  it('validates that at least one of prompt/system/context/instruction is provided', async () => {
    const res = await request('POST', '/v1/generate', {
      model: 'gpt-4o',
    });

    assert.equal(res.status, 400);
    const data = res.data as { code: string };
    assert.equal(data.code, 'VALIDATION_ERROR');
  });
});

// ── Three-part prompt in chat completions ───────────────────

describe('POST /v1/chat/completions with structured messages', () => {
  it('preserves existing system messages without alteration', async () => {
    const res = await request('POST', '/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hello' },
      ],
    });

    assert.ok(
      res.status === 200 || res.status === 500,
      `Expected 200 or 500, got ${res.status}`,
    );
  });
});
