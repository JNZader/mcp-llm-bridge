import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  readRuntimeEnv,
  resolveProviderApiKey,
  resolveProviderApiKeyEnv,
  resolveProviderBaseUrl,
  resolveProviderBaseUrlEnv,
} from '../../src/core/provider-runtime-config.js';

const ENV_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CUSTOM_RUNTIME_ENV'] as const;

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

describe('provider runtime config helpers', () => {
  it('builds provider env names from the provider id', () => {
    assert.equal(resolveProviderApiKeyEnv('openai'), 'OPENAI_API_KEY');
    assert.equal(resolveProviderBaseUrlEnv('openai'), 'OPENAI_BASE_URL');
  });

  it('reads provider runtime env values at call time', () => {
    process.env['OPENAI_API_KEY'] = 'sk-openai';
    process.env['OPENAI_BASE_URL'] = 'https://openai.internal/v1';

    assert.equal(resolveProviderApiKey('openai'), 'sk-openai');
    assert.equal(resolveProviderBaseUrl('openai'), 'https://openai.internal/v1');
  });

  it('reads arbitrary configured env names without changing semantics', () => {
    process.env['CUSTOM_RUNTIME_ENV'] = 'custom-value';

    assert.equal(readRuntimeEnv('CUSTOM_RUNTIME_ENV'), 'custom-value');
    assert.equal(readRuntimeEnv(undefined), undefined);
  });
});
