/**
 * Router optimizeMessages wiring tests.
 *
 * Verifies that generateFromInternal() calls optimizeMessages()
 * on the messages array before outbound transformation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Router } from '../src/core/router.js';
import { TransformerRegistry } from '../src/core/transformer.js';
import type { InternalLLMRequest } from '../src/core/internal-model.js';
import type { LLMProvider, GenerateRequest, GenerateResponse } from '../src/core/types.js';

import { openaiOutbound } from '../src/transformers/outbound/openai.js';

/** Create a mock API provider that captures the generate request. */
function createCapturingProvider(id: string): LLMProvider & { lastRequest?: GenerateRequest } {
  const provider: LLMProvider & { lastRequest?: GenerateRequest } = {
    id,
    name: `Mock ${id}`,
    type: 'api',
    models: [{ id: 'test-model', name: 'Test Model', provider: id, maxTokens: 4096 }],

    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      provider.lastRequest = request;
      return {
        text: `Response from ${id}`,
        provider: id,
        model: 'test-model',
        tokensUsed: 42,
        resolvedProvider: id,
        resolvedModel: 'test-model',
        fallbackUsed: false,
      };
    },

    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
  return provider;
}

describe('Router optimizeMessages wiring', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env['OPTIMIZE_MESSAGES_ENABLED'];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env['OPTIMIZE_MESSAGES_ENABLED'];
    } else {
      process.env['OPTIMIZE_MESSAGES_ENABLED'] = savedEnv;
    }
  });

  it('optimizes flat prompt into system + user in generateFromInternal', async () => {
    process.env['OPTIMIZE_MESSAGES_ENABLED'] = 'true';

    const router = new Router();
    const registry = new TransformerRegistry();
    registry.registerOutbound('mock', openaiOutbound);
    router.setTransformerRegistry(registry);

    const provider = createCapturingProvider('mock');
    router.register(provider);

    const request: InternalLLMRequest = {
      messages: [
        {
          role: 'user',
          content: 'You are an expert in TypeScript.\n\nContext: We use strict mode.\n\nTask: Explain generics.',
        },
      ],
      model: 'test-model',
    };

    await router.generateFromInternal(request);

    assert.ok(provider.lastRequest, 'Provider should have received a request');
    assert.ok(
      provider.lastRequest.system,
      'System prompt should be extracted after optimization',
    );
    assert.ok(
      provider.lastRequest.system?.includes('TypeScript'),
      'System prompt should contain TypeScript expertise',
    );
    assert.ok(
      provider.lastRequest.prompt.includes('generics') || provider.lastRequest.prompt.includes('Context') || provider.lastRequest.prompt.includes('Task'),
      'Prompt should contain instruction or context content',
    );
  });

  it('skips optimization when OPTIMIZE_MESSAGES_ENABLED=false', async () => {
    process.env['OPTIMIZE_MESSAGES_ENABLED'] = 'false';

    const router = new Router();
    const registry = new TransformerRegistry();
    registry.registerOutbound('mock', openaiOutbound);
    router.setTransformerRegistry(registry);

    const provider = createCapturingProvider('mock');
    router.register(provider);

    const request: InternalLLMRequest = {
      messages: [
        {
          role: 'user',
          content: 'You are an expert.\n\nContext: Something.\n\nTask: Do something.',
        },
      ],
      model: 'test-model',
    };

    await router.generateFromInternal(request);

    assert.ok(provider.lastRequest, 'Provider should have received a request');
    assert.equal(
      provider.lastRequest.system,
      undefined,
      'System prompt should NOT be extracted when optimization is disabled',
    );
  });

  it('preserves already-structured messages (system + user)', async () => {
    process.env['OPTIMIZE_MESSAGES_ENABLED'] = 'true';

    const router = new Router();
    const registry = new TransformerRegistry();
    registry.registerOutbound('mock', openaiOutbound);
    router.setTransformerRegistry(registry);

    const provider = createCapturingProvider('mock');
    router.register(provider);

    const request: InternalLLMRequest = {
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hello' },
      ],
      model: 'test-model',
    };

    await router.generateFromInternal(request);

    assert.ok(provider.lastRequest, 'Provider should have received a request');
    assert.equal(
      provider.lastRequest.system,
      'Be helpful',
      'Existing system message should be preserved',
    );
    assert.equal(
      provider.lastRequest.prompt,
      'Hello',
      'User message should be preserved',
    );
  });
});
