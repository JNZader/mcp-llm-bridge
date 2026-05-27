/**
 * Local LLM provider tests — verify LLMProvider interface compliance.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { LocalLLMProvider, LocalLLMError } from '../../src/local-llm/provider.js';

describe('LocalLLMProvider', () => {
  let provider: LocalLLMProvider;

  beforeEach(() => {
    provider = new LocalLLMProvider({ enabled: false });
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
});
