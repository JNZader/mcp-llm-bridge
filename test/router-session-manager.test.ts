import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Router } from '../src/core/router.js';
import { GroupStore } from '../src/core/groups.js';
import type { InternalLLMRequest } from '../src/core/internal-model.js';
import { TransformerRegistry } from '../src/core/transformer.js';
import type {
  GenerateRequest,
  GenerateResponse,
  LLMProvider,
  ModelInfo,
  ProviderType,
} from '../src/core/types.js';
import { SessionManager } from '../src/session/index.js';

function createMockProvider(opts: {
  id: string;
  type?: ProviderType;
  models: ModelInfo[];
  response?: GenerateResponse;
  shouldFail?: boolean;
}): LLMProvider {
  return {
    id: opts.id,
    name: opts.id,
    type: opts.type ?? 'api',
    models: opts.models,
    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      if (opts.shouldFail) {
        throw new Error(`${opts.id} failed`);
      }

      return opts.response ?? {
        text: `response-from-${opts.id}`,
        provider: opts.id,
        model: opts.models[0]?.id ?? 'unknown',
        resolvedProvider: opts.id,
        resolvedModel: opts.models[0]?.id ?? 'unknown',
        fallbackUsed: false,
      };
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

function registerOutbound(registry: TransformerRegistry, providerId: string): void {
  registry.registerOutbound(providerId, {
    name: providerId,
    transformRequest: (_request: InternalLLMRequest) => ({ transformed: true }),
    transformResponse: (_response: unknown) => ({
      content: 'transformed',
      model: providerId,
      finishReason: 'stop' as const,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    }),
  });
}

describe('Router sticky sessions via SessionManager', () => {
  it('reuses the same clientId and model pin', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    const groupStore = new GroupStore(':memory:');
    const sessionManager = new SessionManager();

    router.setTransformerRegistry(registry);
    router.setGroupStore(groupStore);
    router.setSessionManager(sessionManager);

    router.register(createMockProvider({
      id: 'openai',
      models: [{ id: 'gpt-4o', name: 'gpt-4o', provider: 'openai', maxTokens: 4096 }],
      response: {
        text: 'primary',
        provider: 'openai',
        model: 'gpt-4o',
        resolvedProvider: 'openai',
        resolvedModel: 'gpt-4o',
        fallbackUsed: false,
      },
    }));
    router.register(createMockProvider({
      id: 'anthropic',
      models: [{ id: 'gpt-4o', name: 'gpt-4o', provider: 'anthropic', maxTokens: 4096 }],
      response: {
        text: 'secondary',
        provider: 'anthropic',
        model: 'gpt-4o',
        resolvedProvider: 'anthropic',
        resolvedModel: 'gpt-4o',
        fallbackUsed: false,
      },
    }));
    registerOutbound(registry, 'openai');
    registerOutbound(registry, 'anthropic');

    groupStore.create({
      name: 'Sticky GPT',
      modelPattern: 'gpt-*',
      members: [{ provider: 'openai' }, { provider: 'anthropic' }],
      strategy: 'round-robin',
      stickyTTL: 30,
    });

    const request: InternalLLMRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello' }],
      metadata: { clientId: 'client-1' },
    };

    const first = await router.generateFromInternal(request);
    const pinned = sessionManager.getRouterStickySession('client-1', 'gpt-4o');
    const second = await router.generateFromInternal(request);

    assert.equal(first.metadata?.['provider'], 'openai');
    assert.ok(pinned);
    assert.equal(pinned.provider, 'openai');
    assert.equal(second.metadata?.['provider'], 'openai');

    sessionManager.stopCleanup();
    groupStore.close();
  });

  it('falls back when the pinned provider fails and repins the successful provider', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    const groupStore = new GroupStore(':memory:');
    const sessionManager = new SessionManager();

    router.setTransformerRegistry(registry);
    router.setGroupStore(groupStore);
    router.setSessionManager(sessionManager);

    router.register(createMockProvider({
      id: 'openai',
      models: [{ id: 'gpt-4o', name: 'gpt-4o', provider: 'openai', maxTokens: 4096 }],
      shouldFail: true,
    }));
    router.register(createMockProvider({
      id: 'anthropic',
      models: [{ id: 'gpt-4o', name: 'gpt-4o', provider: 'anthropic', maxTokens: 4096 }],
      response: {
        text: 'fallback',
        provider: 'anthropic',
        model: 'gpt-4o',
        resolvedProvider: 'anthropic',
        resolvedModel: 'gpt-4o',
        fallbackUsed: false,
      },
    }));
    registerOutbound(registry, 'openai');
    registerOutbound(registry, 'anthropic');

    groupStore.create({
      name: 'Sticky GPT',
      modelPattern: 'gpt-*',
      members: [{ provider: 'openai' }, { provider: 'anthropic' }],
      strategy: 'failover',
      stickyTTL: 30,
    });

    sessionManager.pinRouterStickySession('client-1', 'gpt-4o', 'openai', 'default', 30_000);

    const result = await router.generateFromInternal({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello' }],
      metadata: { clientId: 'client-1' },
    });

    const repinned = sessionManager.getRouterStickySession('client-1', 'gpt-4o');

    assert.equal(result.metadata?.['provider'], 'anthropic');
    assert.ok(repinned);
    assert.equal(repinned.provider, 'anthropic');

    sessionManager.stopCleanup();
    groupStore.close();
  });
});
