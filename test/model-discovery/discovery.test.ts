import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { afterEach, describe, it, mock } from 'node:test';

import { resetLocalLLMDetectionCache } from '../../src/local-llm/detector.js';
import { discoverModels } from '../../src/model-discovery/discovery.js';
import { Vault } from '../../src/vault/vault.js';
import type { GatewayConfig } from '../../src/core/types.js';

function createVault(): { vault: Vault; dbPath: string } {
  const dbPath = `/tmp/test-discovery-${Date.now()}-${Math.random()}.db`;
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
  resetLocalLLMDetectionCache();
});

describe('discoverModels hardening', () => {
  it('deduplicates concurrent discovery runs with a single in-flight promise', async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 25));
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
      const db = vault.getDb();
      const first = discoverModels(undefined, undefined, db);
      const second = discoverModels(undefined, undefined, db);

      const [resultA, resultB] = await Promise.all([first, second]);
      const result = resultA;
      assert.equal(result.snapshotUsed, false);
      assert.deepEqual(resultA, resultB);
      assert.equal(fetchMock.mock.callCount(), 3);
    } finally {
      vault.destroy();
      cleanupDb(dbPath);
    }
  });

  it('forces a fresh local detection run for explicit discovery requests', async () => {
    const { vault, dbPath } = createVault();
    let generation = 0;
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/tags')) {
        generation += 1;
        return jsonResponse({
          models: [{ name: `custom-model-${generation}` }],
        });
      }
      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    try {
      const db = vault.getDb();
      const first = await discoverModels(undefined, undefined, db);
      const second = await discoverModels(undefined, undefined, db);

      assert.equal(first.models[0]?.local.id, 'custom-model-1');
      assert.equal(second.models[0]?.local.id, 'custom-model-2');
      assert.equal(fetchMock.mock.callCount(), 4);
    } finally {
      vault.destroy();
      cleanupDb(dbPath);
    }
  });

  it('keeps discovery single-flight scoped to the effective local config', async () => {
    const { vault, dbPath } = createVault();
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'http://127.0.0.1:11434/api/tags') {
        return jsonResponse({ models: [{ name: 'ollama-a' }] });
      }
      if (url === 'http://127.0.0.1:21434/api/tags') {
        return jsonResponse({ models: [{ name: 'ollama-b' }] });
      }
      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    try {
      const db = vault.getDb();
      const first = discoverModels(undefined, { ollamaUrl: 'http://127.0.0.1:11434' }, db);
      const second = discoverModels(undefined, { ollamaUrl: 'http://127.0.0.1:21434' }, db);
      const [resultA, resultB] = await Promise.all([first, second]);

      assert.equal(resultA.models[0]?.local.id, 'ollama-a');
      assert.equal(resultB.models[0]?.local.id, 'ollama-b');
      assert.equal(fetchMock.mock.callCount(), 4);
    } finally {
      vault.destroy();
      cleanupDb(dbPath);
    }
  });

  it('returns partial heuristic results when the discovery budget is exhausted', async () => {
    const { vault, dbPath } = createVault();
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/tags')) {
        return jsonResponse({
          models: [
            { name: 'qwen2.5-coder:7b', details: { parameter_size: '7B' } },
            { name: 'llama3.2:3b', details: { parameter_size: '3B' } },
          ],
        });
      }
      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('huggingface.co/api/models/')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse({
          id: 'stub/model',
          tags: ['text-generation'],
          pipeline_tag: 'text-generation',
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    try {
      const result = await discoverModels(
        { discoveryBudgetMs: 1, hfTimeoutMs: 50 },
        undefined,
        vault.getDb(),
      );

      assert.equal(result.partial, true);
      assert.equal(result.snapshotUsed, false);
      assert.equal(result.models.length, 2);
      assert.ok(result.enrichedCount < result.models.length);
      assert.ok(
        result.errors.some((error) => error.includes('Discovery budget exceeded')),
      );
      assert.ok(fetchMock.mock.callCount() >= 2);
    } finally {
      vault.destroy();
      cleanupDb(dbPath);
    }
  });

  it('falls back to the last persisted snapshot when live discovery is unavailable', async () => {
    const { vault, dbPath } = createVault();
    const firstFetch = mock.fn(async (input: string | URL | Request) => {
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
        return jsonResponse({
          id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
          tags: ['text-generation'],
          pipeline_tag: 'text-generation',
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', firstFetch as typeof fetch);

    try {
      const db = vault.getDb();
      const first = await discoverModels(undefined, undefined, db);
      assert.equal(first.models.length, 1);

      mock.restoreAll();

      const secondFetch = mock.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/api/tags') || url.includes('/v1/models')) {
          throw new Error('local runtime offline');
        }

        throw new Error(`Unexpected URL: ${url}`);
      });
      mock.method(globalThis, 'fetch', secondFetch as typeof fetch);

      const fallback = await discoverModels(undefined, undefined, db);

      assert.equal(fallback.snapshotUsed, true);
      assert.equal(fallback.partial, true);
      assert.equal(fallback.models.length, 1);
      assert.ok(
        fallback.errors.some((error) => error.includes('Using stale discovery snapshot')),
      );
    } finally {
      vault.destroy();
      cleanupDb(dbPath);
    }
  });

  it('treats config.enabled as a real kill switch and serves snapshot state without probing', async () => {
    const { vault, dbPath } = createVault();
    const seedFetch = mock.fn(async (input: string | URL | Request) => {
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
        return jsonResponse({
          id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
          tags: ['text-generation'],
          pipeline_tag: 'text-generation',
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', seedFetch as typeof fetch);

    try {
      const db = vault.getDb();
      await discoverModels(undefined, undefined, db);

      mock.restoreAll();

      const disabledFetch = mock.fn(async () => {
        throw new Error('fetch should not run when discovery is disabled');
      });
      mock.method(globalThis, 'fetch', disabledFetch as typeof fetch);

      const disabled = await discoverModels({ enabled: false }, undefined, db);

      assert.equal(disabled.snapshotUsed, true);
      assert.equal(disabled.models.length, 1);
      assert.equal(disabledFetch.mock.callCount(), 0);
      assert.ok(
        disabled.errors.some((error) => error.includes('disabled by config')),
      );
    } finally {
      vault.destroy();
      cleanupDb(dbPath);
    }
  });
});
