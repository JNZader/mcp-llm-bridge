import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getLocalLLMConfig,
  getLocalLLMUrls,
  resolveHfToken,
} from '../../src/core/local-llm-env.js';

const ENV_KEYS = [
  'OLLAMA_URL',
  'LM_STUDIO_URL',
  'LOCAL_LLM_CONNECTION_TIMEOUT_MS',
  'LOCAL_LLM_REQUEST_TIMEOUT_MS',
  'HF_TOKEN',
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
});

describe('local LLM env helpers', () => {
  it('uses documented defaults when env is unset', () => {
    delete process.env['OLLAMA_URL'];
    delete process.env['LM_STUDIO_URL'];
    delete process.env['LOCAL_LLM_CONNECTION_TIMEOUT_MS'];
    delete process.env['LOCAL_LLM_REQUEST_TIMEOUT_MS'];
    delete process.env['HF_TOKEN'];

    assert.deepEqual(getLocalLLMConfig(), {
      ollamaUrl: 'http://localhost:11434',
      lmStudioUrl: 'http://localhost:1234',
      connectionTimeoutMs: 3000,
      requestTimeoutMs: 30000,
    });
    assert.deepEqual(getLocalLLMUrls(), {
      ollamaUrl: 'http://localhost:11434',
      lmStudioUrl: 'http://localhost:1234',
    });
    assert.equal(resolveHfToken(), undefined);
  });

  it('reads env mutations at call time and preserves explicit HF token precedence', () => {
    process.env['OLLAMA_URL'] = 'http://ollama.internal:11434';
    process.env['LM_STUDIO_URL'] = 'http://lmstudio.internal:1234';
    process.env['LOCAL_LLM_CONNECTION_TIMEOUT_MS'] = '15000';
    process.env['LOCAL_LLM_REQUEST_TIMEOUT_MS'] = '120000';
    process.env['HF_TOKEN'] = 'env-token';

    assert.deepEqual(getLocalLLMConfig(), {
      ollamaUrl: 'http://ollama.internal:11434',
      lmStudioUrl: 'http://lmstudio.internal:1234',
      connectionTimeoutMs: 15000,
      requestTimeoutMs: 120000,
    });
    assert.deepEqual(getLocalLLMUrls(), {
      ollamaUrl: 'http://ollama.internal:11434',
      lmStudioUrl: 'http://lmstudio.internal:1234',
    });
    assert.equal(resolveHfToken('body-token'), 'body-token');
    assert.equal(resolveHfToken(), 'env-token');
  });

  it('falls back to defaults for non-positive and non-integer values', () => {
    process.env['LOCAL_LLM_CONNECTION_TIMEOUT_MS'] = '0';
    process.env['LOCAL_LLM_REQUEST_TIMEOUT_MS'] = '30000ms';

    assert.deepEqual(getLocalLLMConfig(), {
      ollamaUrl: 'http://localhost:11434',
      lmStudioUrl: 'http://localhost:1234',
      connectionTimeoutMs: 3000,
      requestTimeoutMs: 30000,
    });
  });

  it('falls back to defaults when timeout values exceed the Node timer limit', () => {
    process.env['LOCAL_LLM_CONNECTION_TIMEOUT_MS'] = '2147483648';
    process.env['LOCAL_LLM_REQUEST_TIMEOUT_MS'] = '9007199254740991';

    assert.deepEqual(getLocalLLMConfig(), {
      ollamaUrl: 'http://localhost:11434',
      lmStudioUrl: 'http://localhost:1234',
      connectionTimeoutMs: 3000,
      requestTimeoutMs: 30000,
    });
  });
});
