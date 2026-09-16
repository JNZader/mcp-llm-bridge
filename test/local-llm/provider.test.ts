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
    text: async () => JSON.stringify(body),
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

  it('contractual mode sends the exact model and bypasses the automatic classifier', async () => {
    provider = new LocalLLMProvider({
      enabled: true,
      ollamaUrl: 'http://ollama.test',
      lmStudioUrl: 'http://lm-studio.test',
    });

    const calls: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/tags')) {
        return jsonResponse({ models: [{ name: 'granite3.2:2b', details: { parameter_size: '2B' } }] });
      }
      if (url.endsWith('/v1/models')) return jsonResponse({ data: [] });
      assert.equal(url, 'http://ollama.test/v1/chat/completions');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        response_format?: { type: string };
      };
      assert.equal(body.model, 'granite3.2:2b');
      assert.deepEqual(body.response_format, { type: 'json_object' });
      return jsonResponse({ choices: [{ message: { content: 'local result' }, finish_reason: 'stop' }] });
    });

    const result = await provider.generate({
      prompt: 'Explain this arbitrary production architecture.',
      provider: 'local-llm',
      model: 'granite3.2:2b',
      strict: true,
      routingMode: 'contractual',
      responseFormat: 'json',
    });

    assert.equal(result.text, 'local result');
    assert.equal(result.resolvedProvider, 'local-llm');
    assert.equal(result.resolvedModel, 'granite3.2:2b');
    assert.equal(result.fallbackUsed, false);
    assert.deepEqual(calls, [
      'http://ollama.test/api/tags',
      'http://lm-studio.test/v1/models',
      'http://ollama.test/v1/chat/completions',
    ]);
  });

  it('contractual mode rejects an unavailable exact model instead of selecting a preferred model', async () => {
    provider = new LocalLLMProvider({ enabled: true, preferredModel: 'other-model' });
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'other-model' }] });
      }
      return jsonResponse({ data: [] });
    });

    await assert.rejects(
      provider.generate({
        prompt: 'arbitrary task',
        provider: 'local-llm',
        model: 'granite3.2:2b',
        routingMode: 'contractual',
      }),
      (error: unknown) =>
        error instanceof LocalLLMError &&
        error.message === 'Contractual model granite3.2:2b is unavailable from local-llm',
    );
  });

  it('automatic mode retains preferred-model selection when the requested model is unavailable', async () => {
    provider = new LocalLLMProvider({
      enabled: true,
      preferredModel: 'other-model',
      ollamaUrl: 'http://ollama.test',
      lmStudioUrl: 'http://lm-studio.test',
    });
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return jsonResponse({ models: [{ name: 'other-model' }] });
      }
      if (url.endsWith('/v1/models')) return jsonResponse({ data: [] });
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        response_format?: unknown;
      };
      assert.equal(body.model, 'other-model');
      assert.equal('response_format' in body, false);
      return jsonResponse({ choices: [{ message: { content: 'automatic result' }, finish_reason: 'stop' }] });
    });

    const result = await provider.generate({
      prompt: 'Summarize this text in one sentence.',
      model: 'granite3.2:2b',
    });

    assert.equal(result.model, 'other-model');
  });

  it('sanitizes bearer tokens from local backend errors', async () => {
    provider = new LocalLLMProvider({ enabled: true });
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/tags')) {
        return jsonResponse({ models: [{ name: 'granite3.2:2b' }] });
      }
      if (url.includes('/v1/models')) return jsonResponse({ data: [] });
      return jsonResponse({ error: 'Bearer super-secret-token' }, 502);
    });

    await assert.rejects(
      provider.generate({
        prompt: 'arbitrary task',
        model: 'granite3.2:2b',
        routingMode: 'contractual',
      }),
      (error: unknown) =>
        error instanceof LocalLLMError &&
        error.message.includes('Bearer [REDACTED]') &&
        !error.message.includes('super-secret-token'),
    );
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
