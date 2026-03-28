/**
 * Integration tests for the full transformer pipeline.
 *
 * Tests the complete flow:
 * raw request → detect inbound format → InternalLLMRequest
 * → outbound transform → mock adapter → response transform → InternalLLMResponse
 *
 * Also tests backward compat (USE_TRANSFORMERS=false) and error cases.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { TransformerRegistry } from '../src/core/transformer.js';
import { TransformError } from '../src/core/transformer.js';
import { Router, useTransformers } from '../src/core/router.js';
import type {
  LLMProvider,
  GenerateRequest,
  GenerateResponse,
  ModelInfo,
  ProviderType,
} from '../src/core/types.js';
import type { InternalLLMRequest, InternalLLMResponse } from '../src/core/internal-model.js';

// ── Inbound transformers ────────────────────────────────────

import { openaiChatInbound } from '../src/transformers/inbound/openai-chat.js';
import { openaiResponsesInbound } from '../src/transformers/inbound/openai-responses.js';
import { anthropicInbound } from '../src/transformers/inbound/anthropic.js';

// ── Outbound transformers ───────────────────────────────────

import { openaiOutbound } from '../src/transformers/outbound/openai.js';
import { anthropicOutbound } from '../src/transformers/outbound/anthropic.js';
import { cliOutbound } from '../src/transformers/outbound/cli.js';

// ── Helpers ─────────────────────────────────────────────────

/** Create a fresh registry with all transformers registered. */
function createRegistry(): TransformerRegistry {
  const registry = new TransformerRegistry();

  // Inbound — order matters for detection (more specific first)
  registry.registerInbound(anthropicInbound);
  registry.registerInbound(openaiResponsesInbound);
  registry.registerInbound(openaiChatInbound);

  // Outbound
  registry.registerOutbound('openai', openaiOutbound);
  registry.registerOutbound('anthropic', anthropicOutbound);
  registry.registerOutbound('cli', cliOutbound);
  registry.registerOutbound('mock-api', openaiOutbound);
  registry.registerOutbound('mock-cli', cliOutbound);

  return registry;
}

/** Create a mock API provider. */
function createMockApiProvider(opts: {
  id: string;
  available?: boolean;
  shouldFail?: boolean;
  failMessage?: string;
  responseText?: string;
}): LLMProvider {
  return {
    id: opts.id,
    name: `Mock ${opts.id}`,
    type: 'api' as ProviderType,
    models: [{ id: 'test-model', name: 'Test Model', provider: opts.id, maxTokens: 4096 }],

    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      if (opts.shouldFail) {
        throw new Error(opts.failMessage ?? `${opts.id} failed`);
      }
      return {
        text: opts.responseText ?? `Response from ${opts.id}`,
        provider: opts.id,
        model: 'test-model',
        tokensUsed: 42,
        resolvedProvider: opts.id,
        resolvedModel: 'test-model',
        fallbackUsed: false,
      };
    },

    async isAvailable(): Promise<boolean> {
      return opts.available ?? true;
    },
  };
}

/** Create a mock CLI provider. */
function createMockCliProvider(opts: {
  id: string;
  available?: boolean;
  shouldFail?: boolean;
  responseText?: string;
}): LLMProvider {
  return {
    id: opts.id,
    name: `Mock CLI ${opts.id}`,
    type: 'cli' as ProviderType,
    models: [{ id: 'cli-model', name: 'CLI Model', provider: opts.id, maxTokens: 8192 }],

    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      if (opts.shouldFail) {
        throw new Error(`${opts.id} CLI failed`);
      }
      return {
        text: opts.responseText ?? `CLI response from ${opts.id}`,
        provider: opts.id,
        model: 'cli-model',
        tokensUsed: 0,
        resolvedProvider: opts.id,
        resolvedModel: 'cli-model',
        fallbackUsed: false,
      };
    },

    async isAvailable(): Promise<boolean> {
      return opts.available ?? true;
    },
  };
}

// ── Test: Full pipeline with OpenAI Chat format ─────────────

describe('Transformer Pipeline Integration', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env['USE_TRANSFORMERS'];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env['USE_TRANSFORMERS'];
    } else {
      process.env['USE_TRANSFORMERS'] = savedEnv;
    }
  });

  describe('Inbound detection + transform → InternalLLMRequest', () => {
    it('detects and transforms OpenAI Chat format', () => {
      const registry = createRegistry();
      // Note: NOT including max_tokens as number — that would match Anthropic
      // detector first (Anthropic requires max_tokens, OpenAI does not)
      const raw = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
      };

      const inbound = registry.detectInbound(raw);
      assert.ok(inbound, 'Should detect OpenAI Chat format');
      assert.equal(inbound.name, 'openai-chat');

      const internal = inbound.transformRequest(raw);
      assert.equal(internal.messages.length, 2);
      assert.equal(internal.model, 'gpt-4o');
      assert.equal(internal.temperature, 0.7);
    });

    it('detects and transforms OpenAI Responses format', () => {
      const registry = createRegistry();
      const raw = {
        model: 'gpt-4o',
        input: 'Hello world',
      };

      const inbound = registry.detectInbound(raw);
      assert.ok(inbound, 'Should detect OpenAI Responses format');
      assert.equal(inbound.name, 'openai-responses');

      const internal = inbound.transformRequest(raw);
      assert.ok(internal.messages.length >= 1);
      assert.equal(internal.model, 'gpt-4o');
    });

    it('detects and transforms Anthropic format', () => {
      const registry = createRegistry();
      const raw = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [
          { role: 'user', content: 'Hello' },
        ],
      };

      const inbound = registry.detectInbound(raw);
      assert.ok(inbound, 'Should detect Anthropic format');
      assert.equal(inbound.name, 'anthropic');

      const internal = inbound.transformRequest(raw);
      assert.ok(internal.messages.length >= 1);
      assert.equal(internal.model, 'claude-sonnet-4-20250514');
      assert.equal(internal.maxTokens, 2048);
    });

    it('returns null for unknown inbound format', () => {
      const registry = createRegistry();
      const raw = {
        unknownField: 'this does not match any format',
        weirdStuff: true,
      };

      const inbound = registry.detectInbound(raw);
      assert.equal(inbound, null, 'Should not detect any format');
    });
  });

  describe('Full flow: inbound → internal → outbound → mock adapter → response', () => {
    it('processes OpenAI Chat request through full pipeline', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);
      router.register(createMockApiProvider({ id: 'mock-api', responseText: 'AI says hello' }));

      const raw = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Hello' },
        ],
      };

      // Step 1: Detect inbound
      const inbound = registry.detectInbound(raw);
      assert.ok(inbound);

      // Step 2: Transform to internal
      const internal = inbound.transformRequest(raw);
      assert.ok(internal.messages.length > 0);

      // Step 3: Route through transformer pipeline
      const response = await router.generateFromInternal(internal);

      assert.equal(response.content, 'AI says hello');
      assert.equal(response.finishReason, 'stop');
      assert.ok(response.usage);
    });

    it('processes Anthropic request through full pipeline', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);
      router.register(createMockApiProvider({ id: 'mock-api', responseText: 'Claude says hi' }));

      const raw = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: 'Hello from Anthropic' },
        ],
      };

      const inbound = registry.detectInbound(raw);
      assert.ok(inbound);
      assert.equal(inbound.name, 'anthropic');

      const internal = inbound.transformRequest(raw);
      const response = await router.generateFromInternal(internal);

      assert.equal(response.content, 'Claude says hi');
      assert.equal(response.finishReason, 'stop');
    });

    it('processes OpenAI Responses request through full pipeline', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);
      router.register(createMockApiProvider({ id: 'mock-api', responseText: 'Responses format reply' }));

      const raw = {
        model: 'gpt-4o',
        input: 'Simple prompt',
      };

      const inbound = registry.detectInbound(raw);
      assert.ok(inbound);
      assert.equal(inbound.name, 'openai-responses');

      const internal = inbound.transformRequest(raw);
      const response = await router.generateFromInternal(internal);

      assert.equal(response.content, 'Responses format reply');
    });
  });

  describe('Fallback behavior', () => {
    it('falls back to next provider when first fails', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);

      // First provider fails, second succeeds
      router.register(createMockApiProvider({
        id: 'mock-api',
        shouldFail: true,
        failMessage: 'Primary down',
      }));
      router.register(createMockApiProvider({
        id: 'mock-api',
        responseText: 'Fallback response',
      }));

      const internal: InternalLLMRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await router.generateFromInternal(internal);
      assert.equal(response.content, 'Fallback response');
    });

    it('throws when all providers fail', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);

      router.register(createMockApiProvider({
        id: 'mock-api',
        shouldFail: true,
        failMessage: 'Provider 1 down',
      }));

      const internal: InternalLLMRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await assert.rejects(
        () => router.generateFromInternal(internal),
        /All providers failed/,
      );
    });

    it('throws when no providers are registered', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);

      const internal: InternalLLMRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await assert.rejects(
        () => router.generateFromInternal(internal),
        /No providers available/,
      );
    });
  });

  describe('USE_TRANSFORMERS env flag', () => {
    it('useTransformers() returns false by default', () => {
      delete process.env['USE_TRANSFORMERS'];
      assert.equal(useTransformers(), false);
    });

    it('useTransformers() returns true when set', () => {
      process.env['USE_TRANSFORMERS'] = 'true';
      assert.equal(useTransformers(), true);
    });

    it('useTransformers() returns false for non-true values', () => {
      process.env['USE_TRANSFORMERS'] = 'false';
      assert.equal(useTransformers(), false);

      process.env['USE_TRANSFORMERS'] = '1';
      assert.equal(useTransformers(), false);

      process.env['USE_TRANSFORMERS'] = 'yes';
      assert.equal(useTransformers(), false);
    });
  });

  describe('Backward compatibility (legacy generate)', () => {
    it('legacy generate() still works without transformer registry', async () => {
      const router = new Router();
      router.register(createMockApiProvider({
        id: 'mock-api',
        responseText: 'Legacy response',
      }));

      const request: GenerateRequest = {
        prompt: 'Hello legacy',
      };

      const result = await router.generate(request);
      assert.equal(result.text, 'Legacy response');
      assert.equal(result.resolvedProvider, 'mock-api');
    });

    it('legacy generate() ignores transformer registry even when set', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);
      router.register(createMockApiProvider({
        id: 'mock-api',
        responseText: 'Still legacy',
      }));

      const request: GenerateRequest = {
        prompt: 'Hello',
      };

      const result = await router.generate(request);
      assert.equal(result.text, 'Still legacy');
    });
  });

  describe('Router transformer registry', () => {
    it('throws when generateFromInternal called without registry', async () => {
      const router = new Router();
      router.register(createMockApiProvider({ id: 'mock-api' }));

      const internal: InternalLLMRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await assert.rejects(
        () => router.generateFromInternal(internal),
        /Transformer registry not configured/,
      );
    });

    it('setTransformerRegistry makes registry available', () => {
      const registry = createRegistry();
      const router = new Router();
      assert.equal(router.transformerRegistry, null);

      router.setTransformerRegistry(registry);
      assert.ok(router.transformerRegistry);
      assert.equal(router.transformerRegistry, registry);
    });
  });

  describe('CLI provider through transformer pipeline', () => {
    it('routes to CLI provider using CLI outbound transformer', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);
      router.register(createMockCliProvider({
        id: 'mock-cli',
        responseText: 'CLI output',
      }));

      const internal: InternalLLMRequest = {
        messages: [{ role: 'user', content: 'Hello CLI' }],
      };

      const response = await router.generateFromInternal(internal);
      assert.equal(response.content, 'CLI output');
    });
  });

  describe('Response shape validation', () => {
    it('InternalLLMResponse has required fields', async () => {
      const registry = createRegistry();
      const router = new Router();
      router.setTransformerRegistry(registry);
      router.register(createMockApiProvider({ id: 'mock-api' }));

      const internal: InternalLLMRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await router.generateFromInternal(internal);

      // Verify all required InternalLLMResponse fields exist
      assert.ok(typeof response.content === 'string');
      assert.ok(typeof response.model === 'string');
      assert.ok(typeof response.finishReason === 'string');
      assert.ok(response.usage);
      assert.ok(typeof response.usage.inputTokens === 'number');
      assert.ok(typeof response.usage.outputTokens === 'number');
      assert.ok(typeof response.usage.totalTokens === 'number');
    });
  });
});
