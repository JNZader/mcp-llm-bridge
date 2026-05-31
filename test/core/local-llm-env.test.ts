import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getLocalLLMUrls, resolveHfToken } from '../../src/core/local-llm-env.js';

const ENV_KEYS = ['OLLAMA_URL', 'LM_STUDIO_URL', 'HF_TOKEN'] as const;

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
    delete process.env['HF_TOKEN'];

    assert.deepEqual(getLocalLLMUrls(), {
      ollamaUrl: 'http://localhost:11434',
      lmStudioUrl: 'http://localhost:1234',
    });
    assert.equal(resolveHfToken(), undefined);
  });

  it('reads env mutations at call time and preserves explicit HF token precedence', () => {
    process.env['OLLAMA_URL'] = 'http://ollama.internal:11434';
    process.env['LM_STUDIO_URL'] = 'http://lmstudio.internal:1234';
    process.env['HF_TOKEN'] = 'env-token';

    assert.deepEqual(getLocalLLMUrls(), {
      ollamaUrl: 'http://ollama.internal:11434',
      lmStudioUrl: 'http://lmstudio.internal:1234',
    });
    assert.equal(resolveHfToken('body-token'), 'body-token');
    assert.equal(resolveHfToken(), 'env-token');
  });
});
