/**
 * Local LLM detector tests — parameter parsing, model picking.
 *
 * Network-dependent probing is tested via mocked fetch in integration tests.
 * These unit tests cover the pure logic: parsing and selection.
 */

import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectLocalLLMs,
  parseParameterSize,
  pickBestLocalModel,
  resetLocalLLMDetectionCache,
} from '../../src/local-llm/detector.js';
import type { DetectionResult, LocalModel } from '../../src/local-llm/types.js';

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

// ── parseParameterSize ──────────────────────────────────────

describe('parseParameterSize', () => {
  it('parses "7B" to 7', () => {
    assert.equal(parseParameterSize('7B'), 7);
  });

  it('parses "3.2b" to 3.2', () => {
    assert.equal(parseParameterSize('3.2b'), 3.2);
  });

  it('parses "70B" to 70', () => {
    assert.equal(parseParameterSize('70B'), 70);
  });

  it('returns undefined for empty string', () => {
    assert.equal(parseParameterSize(''), undefined);
  });

  it('returns undefined for non-matching string', () => {
    assert.equal(parseParameterSize('unknown'), undefined);
  });

  it('parses "1.5 B" with space', () => {
    assert.equal(parseParameterSize('1.5 B'), 1.5);
  });
});

// ── pickBestLocalModel ──────────────────────────────────────

describe('pickBestLocalModel', () => {
  const ollamaModel: LocalModel = {
    id: 'llama3.2:3b',
    name: 'llama3.2:3b',
    backend: 'ollama',
    parameterSize: 3.2,
    loaded: true,
  };

  const lmStudioModel: LocalModel = {
    id: 'codellama-7b',
    name: 'codellama-7b',
    backend: 'lm-studio',
    loaded: true,
  };

  const connectedOllama: DetectionResult = {
    backend: 'ollama',
    status: 'connected',
    baseUrl: 'http://localhost:11434',
    models: [ollamaModel],
  };

  const connectedLMStudio: DetectionResult = {
    backend: 'lm-studio',
    status: 'connected',
    baseUrl: 'http://localhost:1234',
    models: [lmStudioModel],
  };

  const disconnected: DetectionResult = {
    backend: 'ollama',
    status: 'disconnected',
    baseUrl: 'http://localhost:11434',
    models: [],
  };

  it('returns null when no backends connected', () => {
    assert.equal(pickBestLocalModel([disconnected]), null);
  });

  it('returns null for empty results', () => {
    assert.equal(pickBestLocalModel([]), null);
  });

  it('picks first model from first connected backend', () => {
    const result = pickBestLocalModel([connectedOllama, connectedLMStudio]);
    assert.equal(result?.id, 'llama3.2:3b');
  });

  it('finds preferred model across backends', () => {
    const result = pickBestLocalModel(
      [connectedOllama, connectedLMStudio],
      'codellama-7b',
    );
    assert.equal(result?.id, 'codellama-7b');
    assert.equal(result?.backend, 'lm-studio');
  });

  it('falls back to first model when preferred not found', () => {
    const result = pickBestLocalModel([connectedOllama], 'nonexistent-model');
    assert.equal(result?.id, 'llama3.2:3b');
  });

  it('skips connected backends with no models', () => {
    const emptyConnected: DetectionResult = {
      backend: 'ollama',
      status: 'connected',
      baseUrl: 'http://localhost:11434',
      models: [],
    };
    const result = pickBestLocalModel([emptyConnected, connectedLMStudio]);
    assert.equal(result?.id, 'codellama-7b');
  });
});

describe('detectLocalLLMs cache hardening', () => {
  it('shares one in-flight probe across concurrent callers', async () => {
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);
      await new Promise((resolve) => setTimeout(resolve, 20));

      if (url.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }] });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const [first, second, third] = await Promise.all([
      detectLocalLLMs(undefined, { successCacheTtlMs: 50, failureCacheTtlMs: 25 }),
      detectLocalLLMs(undefined, { successCacheTtlMs: 50, failureCacheTtlMs: 25 }),
      detectLocalLLMs(undefined, { successCacheTtlMs: 50, failureCacheTtlMs: 25 }),
    ]);

    assert.deepEqual(first, second);
    assert.deepEqual(second, third);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it('reuses success results within the success TTL', async () => {
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'qwen2.5-coder:7b', details: { parameter_size: '7B' } }] });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const options = { successCacheTtlMs: 40, failureCacheTtlMs: 20 };
    const first = await detectLocalLLMs(undefined, options);
    const second = await detectLocalLLMs(undefined, options);

    assert.deepEqual(second, first);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it('honors failure cooldown for repeated dead-backend calls', async () => {
    const fetchMock = mock.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const options = { successCacheTtlMs: 40, failureCacheTtlMs: 35 };
    const first = await detectLocalLLMs(undefined, options);
    const second = await detectLocalLLMs(undefined, options);

    assert.deepEqual(second, first);
    assert.equal(fetchMock.mock.callCount(), 2);

    await new Promise((resolve) => setTimeout(resolve, 45));
    await detectLocalLLMs(undefined, options);

    assert.equal(fetchMock.mock.callCount(), 4);
  });

  it('bypasses settled cache when forceRefresh is set', async () => {
    let generation = 0;
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        generation += 1;
        return jsonResponse({
          models: [{ name: `model-${generation}`, details: { parameter_size: '7B' } }],
        });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const options = { successCacheTtlMs: 100, failureCacheTtlMs: 50 };
    const first = await detectLocalLLMs(undefined, options);
    const refreshed = await detectLocalLLMs(undefined, { ...options, forceRefresh: true });

    assert.notDeepEqual(refreshed, first);
    assert.equal(first[0]?.models[0]?.id, 'model-1');
    assert.equal(refreshed[0]?.models[0]?.id, 'model-2');
    assert.equal(fetchMock.mock.callCount(), 4);
  });
});
