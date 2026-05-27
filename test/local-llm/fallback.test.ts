/**
 * Router local LLM fallback tests — verify LocalLLMError catch + fallback.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Router } from '../../src/core/router.js';
import { LocalLLMError } from '../../src/local-llm/client.js';
import type { LLMProvider, GenerateResponse } from '../../src/core/types.js';

describe('Router local LLM fallback', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  it('inserts local-llm as first candidate when task is offloadable', async () => {
    const localProvider: LLMProvider = {
      id: 'local-llm',
      name: 'Local LLM',
      type: 'api',
      models: [{ id: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'local-llm', maxTokens: 4096 }],
      async isAvailable() { return true; },
      async generate() {
        throw new LocalLLMError('test failure', 'ollama');
      },
    };

    const cloudProvider: LLMProvider = {
      id: 'cloud',
      name: 'Cloud Provider',
      type: 'api',
      models: [{ id: 'gpt-4', name: 'GPT-4', provider: 'cloud', maxTokens: 8192 }],
      async isAvailable() { return true; },
      async generate(): Promise<GenerateResponse> {
        return {
          text: 'cloud result',
          provider: 'cloud',
          model: 'gpt-4',
          resolvedProvider: 'cloud',
          resolvedModel: 'gpt-4',
          fallbackUsed: false,
        };
      },
    };

    router.register(cloudProvider);
    router.register(localProvider);

    const result = await router.generate({ prompt: 'write a commit message' });
    assert.equal(result.text, 'cloud result');
    assert.equal(result.fallbackUsed, true); // local was tried first, fell back
  });

  it('does not insert local-llm first when task is not offloadable', async () => {
    const localProvider: LLMProvider = {
      id: 'local-llm',
      name: 'Local LLM',
      type: 'api',
      models: [{ id: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'local-llm', maxTokens: 4096 }],
      async isAvailable() { return true; },
      async generate() {
        return {
          text: 'local result',
          provider: 'local-llm',
          model: 'llama3.2:3b',
          resolvedProvider: 'local-llm',
          resolvedModel: 'llama3.2:3b',
          fallbackUsed: false,
        };
      },
    };

    const cloudProvider: LLMProvider = {
      id: 'cloud',
      name: 'Cloud Provider',
      type: 'api',
      models: [{ id: 'gpt-4', name: 'GPT-4', provider: 'cloud', maxTokens: 8192 }],
      async isAvailable() { return true; },
      async generate(): Promise<GenerateResponse> {
        return {
          text: 'cloud result',
          provider: 'cloud',
          model: 'gpt-4',
          resolvedProvider: 'cloud',
          resolvedModel: 'gpt-4',
          fallbackUsed: false,
        };
      },
    };

    router.register(cloudProvider);
    router.register(localProvider);

    // "security audit" is NOT offloadable
    const result = await router.generate({ prompt: 'security audit and threat model' });
    assert.equal(result.text, 'cloud result');
    assert.equal(result.fallbackUsed, false); // cloud went first, no fallback needed
  });

  it('catches LocalLLMError and falls back to next candidate', async () => {
    const localProvider: LLMProvider = {
      id: 'local-llm',
      name: 'Local LLM',
      type: 'api',
      models: [{ id: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'local-llm', maxTokens: 4096 }],
      async isAvailable() { return true; },
      async generate() {
        throw new LocalLLMError('connection refused', 'ollama');
      },
    };

    const cloudProvider: LLMProvider = {
      id: 'cloud',
      name: 'Cloud Provider',
      type: 'api',
      models: [{ id: 'gpt-4', name: 'GPT-4', provider: 'cloud', maxTokens: 8192 }],
      async isAvailable() { return true; },
      async generate(): Promise<GenerateResponse> {
        return {
          text: 'fallback success',
          provider: 'cloud',
          model: 'gpt-4',
          resolvedProvider: 'cloud',
          resolvedModel: 'gpt-4',
          fallbackUsed: false,
        };
      },
    };

    router.register(localProvider);
    router.register(cloudProvider);

    const result = await router.generate({ prompt: 'summarize this' });
    assert.equal(result.text, 'fallback success');
    assert.equal(result.fallbackUsed, true);
  });

  it('returns error when both local and cloud fail', async () => {
    const localProvider: LLMProvider = {
      id: 'local-llm',
      name: 'Local LLM',
      type: 'api',
      models: [{ id: 'llama3.2:3b', name: 'Llama 3.2 3B', provider: 'local-llm', maxTokens: 4096 }],
      async isAvailable() { return true; },
      async generate() {
        throw new LocalLLMError('down', 'ollama');
      },
    };

    const cloudProvider: LLMProvider = {
      id: 'cloud',
      name: 'Cloud Provider',
      type: 'api',
      models: [{ id: 'gpt-4', name: 'GPT-4', provider: 'cloud', maxTokens: 8192 }],
      async isAvailable() { return true; },
      async generate() {
        throw new Error('cloud down');
      },
    };

    router.register(localProvider);
    router.register(cloudProvider);

    try {
      await router.generate({ prompt: 'convert to json' });
      assert.fail('Expected error');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok((error as Error).message.includes('All providers failed'));
    }
  });
});
