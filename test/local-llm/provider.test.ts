/**
 * Local LLM provider tests — verify LLMProvider interface compliance.
 */

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { LocalLLMProvider, LocalLLMError } from '../../src/local-llm/provider.js';
import { resetLocalLLMDetectionCache } from '../../src/local-llm/detector.js';
import { logger } from '../../src/core/logger.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    json: async () => body,
  } as Response;
}

describe('LocalLLMProvider', () => {
  let provider: LocalLLMProvider;

  beforeEach(() => {
    provider = new LocalLLMProvider({ enabled: false });
  });

  afterEach(() => {
    mock.restoreAll();
    resetLocalLLMDetectionCache();
  });

  it('has correct id and name', () => {
    assert.equal(provider.id, 'local-llm');
    assert.equal(provider.name, 'Local LLM (Ollama/LM Studio)');
    assert.equal(provider.type, 'api');
  });

  it('models is empty by default', () => {
    assert.deepEqual(provider.models, []);
  });

  it('isAvailable returns false when disabled', async () => {
    const available = await provider.isAvailable();
    assert.equal(available, false);
  });

  it('generate throws LocalLLMError when disabled', async () => {
    try {
      await provider.generate({ prompt: 'hello' });
      assert.fail('Expected LocalLLMError');
    } catch (error) {
      assert.ok(error instanceof LocalLLMError);
      assert.equal((error as LocalLLMError).message, 'Local LLM is disabled');
    }
  });

  it('LocalLLMError is re-exported', () => {
    const err = new LocalLLMError('test', 'ollama');
    assert.equal(err.name, 'LocalLLMError');
    assert.equal(err.backend, 'ollama');
  });

  it('isAvailable reuses shared detection cache within the TTL', async () => {
    provider = new LocalLLMProvider({ enabled: true });

    const fetchMock = mock.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }] });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    mock.method(globalThis, 'fetch', fetchMock as typeof fetch);

    assert.equal(await provider.isAvailable(), true);
    assert.equal(await provider.isAvailable(), true);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it('logs concrete backend summaries after refresh', async () => {
    provider = new LocalLLMProvider({ enabled: true });

    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'llama3.2:3b', details: { parameter_size: '3.2B' } }] });
      }

      if (url.includes('/v1/models')) {
        return jsonResponse({ data: [{ id: 'deepseek-coder-6.7b' }] });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const infoMock = mock.method(logger, 'info', () => logger);

    await provider.refreshModels();

    assert.equal(infoMock.mock.callCount(), 1);
    assert.deepEqual(infoMock.mock.calls[0]?.arguments[0], {
      connectedBackendCount: 2,
      connectedBackends: [
        {
          backend: 'ollama',
          modelCount: 1,
          modelIds: ['llama3.2:3b'],
        },
        {
          backend: 'lm-studio',
          modelCount: 1,
          modelIds: ['deepseek-coder-6.7b'],
        },
      ],
      modelCount: 2,
    });
  });
});
