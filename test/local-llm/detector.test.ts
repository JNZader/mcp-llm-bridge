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
  getLocalLLMStatus,
  parseParameterSize,
  pickBestLocalModel,
  resetLocalLLMDetectionCache,
} from '../../src/local-llm/detector.js';
import { getSlimLocalLLMStatus, toSlimLocalLLMStatus } from '../../src/local-llm/status.js';
import type { DetectionResult, LocalModel } from '../../src/local-llm/types.js';
import {
  createFakeTimeoutHandle,
  createMockClearTimeout,
  createMockSetTimeout,
} from '../helpers/timeout-mocks.js';

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
  it('clears backend abort timers when probing fails early', async () => {
    const timeoutTokens = [createFakeTimeoutHandle('ollama'), createFakeTimeoutHandle('lm-studio')];
    const setTimeoutMock = createMockSetTimeout(() => {
      const timeoutToken = timeoutTokens.shift();
      assert.ok(timeoutToken);
      return timeoutToken;
    });
    const clearTimeoutMock = createMockClearTimeout();
    const fetchMock = mock.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    mock.method(globalThis, 'setTimeout', setTimeoutMock);
    mock.method(globalThis, 'clearTimeout', clearTimeoutMock);
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const results = await detectLocalLLMs(undefined, { forceRefresh: true });

    assert.equal(fetchMock.mock.callCount(), 2);
    assert.equal(setTimeoutMock.mock.callCount(), 2);
    assert.equal(clearTimeoutMock.mock.callCount(), 2);
    assert.deepEqual(
      clearTimeoutMock.mock.calls.map((call) => call.arguments[0]),
      [createFakeTimeoutHandle('ollama'), createFakeTimeoutHandle('lm-studio')],
    );
    assert.equal(results[0]?.status, 'disconnected');
    assert.equal(results[1]?.status, 'disconnected');
  });

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

describe('getLocalLLMStatus', () => {
  it('returns an aggregated operational snapshot and reports cache reuse', async () => {
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'qwen2.5-coder:7b', details: { parameter_size: '7B' } }] });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [{ id: 'deepseek-coder-6.7b' }] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const first = await getLocalLLMStatus(undefined, { successCacheTtlMs: 50, failureCacheTtlMs: 25 });
    const second = await getLocalLLMStatus(undefined, { successCacheTtlMs: 50, failureCacheTtlMs: 25 });

    assert.equal(first.enabled, true);
    assert.equal(first.ready, true);
    assert.equal(first.readyReason, 'At least one local model is available');
    assert.equal(first.source, 'probe');
    assert.equal(first.cacheHit, false);
    assert.equal(first.backendCount, 2);
    assert.equal(first.connectedBackendCount, 2);
    assert.equal(first.disconnectedBackendCount, 0);
    assert.equal(first.errorBackendCount, 0);
    assert.equal(first.modelCount, 2);
    assert.equal(typeof first.checkedAt, 'string');
    assert.equal(first.backends[0]?.modelCount, 1);

    assert.equal(second.source, 'cache');
    assert.equal(second.cacheHit, true);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it('can return a disabled snapshot without probing', async () => {
    const fetchMock = mock.fn(async () => jsonResponse({ models: [] }));
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const status = await getLocalLLMStatus(
      { enabled: false },
      { skipDetectionWhenDisabled: true },
    );

    assert.equal(status.enabled, false);
    assert.equal(status.ready, false);
    assert.equal(status.readyReason, 'Local LLM is disabled by runtime flag');
    assert.equal(status.source, 'disabled');
    assert.equal(status.cacheHit, false);
    assert.equal(status.backendCount, 2);
    assert.equal(status.connectedBackendCount, 0);
    assert.equal(status.disconnectedBackendCount, 2);
    assert.equal(status.errorBackendCount, 0);
    assert.equal(status.modelCount, 0);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('explains when backends are reachable but expose no models', async () => {
    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        return jsonResponse({ models: [] });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const status = await getLocalLLMStatus(undefined, { forceRefresh: true });

    assert.equal(status.ready, false);
    assert.equal(status.connectedBackendCount, 2);
    assert.equal(status.modelCount, 0);
    assert.equal(status.readyReason, 'Backends are reachable but no local models were reported');
  });
});

describe('local LLM slim status helpers', () => {
  it('maps a full status to the shared slim shape', () => {
    const slim = toSlimLocalLLMStatus({
      enabled: true,
      ready: false,
      readyReason: 'No local LLM backends are connected',
      checkedAt: '2026-05-31T00:00:00.000Z',
      source: 'probe',
      cacheHit: false,
      backendCount: 2,
      connectedBackendCount: 1,
      disconnectedBackendCount: 1,
      errorBackendCount: 0,
      modelCount: 3,
      backends: [
        {
          backend: 'ollama',
          status: 'connected',
          baseUrl: 'http://localhost:11434',
          models: [
            {
              id: 'qwen2.5-coder:7b',
              name: 'qwen2.5-coder:7b',
              backend: 'ollama',
              parameterSize: 7,
              loaded: true,
            },
            {
              id: 'llama3.2:3b',
              name: 'llama3.2:3b',
              backend: 'ollama',
              parameterSize: 3.2,
              loaded: false,
            },
          ],
          modelCount: 2,
        },
        {
          backend: 'lm-studio',
          status: 'disconnected',
          baseUrl: 'http://localhost:1234',
          models: [
            {
              id: 'deepseek-coder-6.7b',
              name: 'deepseek-coder-6.7b',
              backend: 'lm-studio',
              loaded: true,
            },
          ],
          error: 'ECONNREFUSED',
          modelCount: 1,
        },
      ],
    });

    assert.deepEqual(slim, {
      enabled: true,
      ready: false,
      readyReason: 'No local LLM backends are connected',
      checkedAt: '2026-05-31T00:00:00.000Z',
      source: 'probe',
      cacheHit: false,
      backendCount: 2,
      connectedBackendCount: 1,
      disconnectedBackendCount: 1,
      errorBackendCount: 0,
      modelCount: 3,
      backends: [
        {
          backend: 'ollama',
          status: 'connected',
          baseUrl: 'http://localhost:11434',
          error: undefined,
          modelCount: 2,
          models: [
            {
              id: 'qwen2.5-coder:7b',
              name: 'qwen2.5-coder:7b',
              loaded: true,
              parameterSize: 7,
              contextWindow: undefined,
            },
            {
              id: 'llama3.2:3b',
              name: 'llama3.2:3b',
              loaded: false,
              parameterSize: 3.2,
              contextWindow: undefined,
            },
          ],
        },
        {
          backend: 'lm-studio',
          status: 'disconnected',
          baseUrl: 'http://localhost:1234',
          error: 'ECONNREFUSED',
          modelCount: 1,
          models: [
            {
              id: 'deepseek-coder-6.7b',
              name: 'deepseek-coder-6.7b',
              loaded: true,
              parameterSize: undefined,
              contextWindow: undefined,
            },
          ],
        },
      ],
    });
  });

  it('builds a disabled slim snapshot without probing', async () => {
    const fetchMock = mock.fn(async () => jsonResponse({ models: [] }));
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    const status = await getSlimLocalLLMStatus(
      { enabled: false },
      { skipDetectionWhenDisabled: true },
    );

    assert.equal(status.enabled, false);
    assert.equal(status.ready, false);
    assert.equal(status.readyReason, 'Local LLM is disabled by runtime flag');
    assert.equal(status.source, 'disabled');
    assert.equal(status.cacheHit, false);
    assert.equal(status.backendCount, 2);
    assert.equal(status.connectedBackendCount, 0);
    assert.equal(status.disconnectedBackendCount, 2);
    assert.equal(status.errorBackendCount, 0);
    assert.equal(status.modelCount, 0);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
