/**
 * Local LLM client tests — error handling and URL construction.
 *
 * Network calls are NOT tested here (no mocking fetch in node:test).
 * We test the error class and exported contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LocalLLMError } from '../../src/local-llm/client.js';

// ── LocalLLMError ──────────────────────────────────────────

describe('LocalLLMError', () => {
  it('has correct name', () => {
    const err = new LocalLLMError('test', 'ollama');
    assert.equal(err.name, 'LocalLLMError');
  });

  it('stores backend type', () => {
    const err = new LocalLLMError('test', 'lm-studio');
    assert.equal(err.backend, 'lm-studio');
  });

  it('stores cause when provided', () => {
    const cause = new Error('network');
    const err = new LocalLLMError('test', 'ollama', cause);
    assert.equal(err.cause, cause);
  });

  it('is an instanceof Error', () => {
    const err = new LocalLLMError('test', 'ollama');
    assert.ok(err instanceof Error);
  });

  it('preserves message', () => {
    const err = new LocalLLMError('Connection refused', 'ollama');
    assert.equal(err.message, 'Connection refused');
  });
});
