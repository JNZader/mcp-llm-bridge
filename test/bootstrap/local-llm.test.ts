import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';

import { bootstrapLocalLLM } from '../../src/bootstrap/local-llm.js';
import { Router } from '../../src/core/router.js';
import { Vault } from '../../src/vault/vault.js';
import type { GatewayConfig } from '../../src/core/types.js';

function createVault(): { vault: Vault; dbPath: string } {
  const dbPath = `/tmp/test-bootstrap-local-llm-${Date.now()}-${Math.random()}.db`;
  const config: GatewayConfig = {
    masterKey: randomBytes(32),
    dbPath,
    httpPort: 0,
  };

  return { vault: new Vault(config), dbPath };
}

function cleanupDb(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = dbPath + suffix;
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    json: async () => body,
  } as Response;
}

afterEach(() => {
  mock.restoreAll();
  delete process.env.LOCAL_LLM_ENABLED;
  delete process.env.AUTO_DISCOVER_MODELS;
});

describe('bootstrapLocalLLM', () => {
  it('does not wait for full HF enrichment before completing startup', async () => {
    process.env.LOCAL_LLM_ENABLED = 'true';
    process.env.AUTO_DISCOVER_MODELS = 'true';

    const { vault, dbPath } = createVault();
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/tags')) {
        return jsonResponse({
          models: [{ name: 'qwen2.5-coder:7b', details: { parameter_size: '7B' } }],
        });
      }
      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('huggingface.co/api/models/')) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return jsonResponse({
          id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
          tags: ['text-generation'],
          pipeline_tag: 'text-generation',
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    try {
      const startedAt = Date.now();
      await bootstrapLocalLLM(new Router(), vault.getDb());
      const elapsedMs = Date.now() - startedAt;

      assert.ok(elapsedMs < 150, `bootstrapLocalLLM took ${elapsedMs}ms`);

      // Let the background discovery finish so the mocked fetch can be restored cleanly.
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.ok(fetchMock.mock.callCount() >= 3);
    } finally {
      vault.destroy();
      cleanupDb(dbPath);
    }
  });
});
