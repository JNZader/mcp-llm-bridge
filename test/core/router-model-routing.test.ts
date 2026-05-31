/**
 * Router + ModelRouter integration tests.
 *
 * Covers:
 * - Router with ModelRouter: routes task to preferred endpoint
 * - Router without ModelRouter: backward compatible behavior
 * - ModelRouter endpoint not found: falls back to default
 * - Feedback recorded on success
 * - Feedback recorded on failure
 * - Feedback failure is non-blocking
 * - Precedence: local-llm vs ModelRouter
 * - generateFromInternal integration
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getCircuitBreakerV2, Router, resetCircuitBreakerV2 } from '../../src/core/router.js';
import { TransformerRegistry } from '../../src/core/transformer.js';
import { LocalLLMError } from '../../src/local-llm/client.js';
import type {
  LLMProvider,
  GenerateRequest,
  GenerateResponse,
  ModelInfo,
  ProviderType,
} from '../../src/core/types.js';
import type { InternalLLMRequest } from '../../src/core/internal-model.js';
import type { ModelRouter } from '../../src/model-routing/router.js';
import type { RoutingDecision, ModelEndpoint, RouteRule } from '../../src/model-routing/types.js';
import type { TaskClassification } from '../../src/classification/index.js';

// ── Helpers ───────────────────────────────────────────────

function createMockProvider(opts: {
  id: string;
  name: string;
  type: ProviderType;
  models: ModelInfo[];
  available?: boolean;
  response?: GenerateResponse;
  shouldFail?: boolean;
  failMessage?: string;
  onGenerate?: (request: GenerateRequest) => void;
}): LLMProvider {
  return {
    id: opts.id,
    name: opts.name,
    type: opts.type,
    models: opts.models,

    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      opts.onGenerate?.(_request);
      if (opts.shouldFail) {
        throw new Error(opts.failMessage ?? `${opts.id} failed`);
      }
      return opts.response ?? {
        text: `Response from ${opts.id}`,
        provider: opts.id,
        model: opts.models[0]?.id ?? 'unknown',
        resolvedProvider: opts.id,
        resolvedModel: opts.models[0]?.id ?? 'unknown',
        fallbackUsed: false,
      };
    },

    async isAvailable(): Promise<boolean> {
      return opts.available ?? true;
    },
  };
}

function createMockModelRouter(opts: {
  enabled?: boolean;
  decision?: RoutingDecision | null;
  onRecordFeedback?: (feedback: {
    endpointId: string;
    selectedEndpointId?: string;
    taskPattern: string;
    acceptable: boolean;
    latencyMs: number;
  }) => void;
  onRoute?: (classification: TaskClassification) => void;
}): ModelRouter {
  return {
    enabled: opts.enabled ?? true,

    route(classification: TaskClassification): RoutingDecision | null {
      opts.onRoute?.(classification);
      return opts.decision ?? null;
    },

    recordFeedback(feedback: {
      endpointId: string;
      selectedEndpointId?: string;
      taskPattern: string;
      acceptable: boolean;
      latencyMs: number;
      timestamp: string;
    }): void {
      opts.onRecordFeedback?.(feedback);
    },

    // Stub remaining ModelRouter methods so TS is happy
    getQualityStats: () => null,
    getEndpointsByCost: () => [],
    setEndpointAvailability: () => {},
    findEndpointForProvider: () => null,
  } as unknown as ModelRouter;
}

function createMockEndpoint(opts: Partial<ModelEndpoint> & { id: string }): ModelEndpoint {
  return {
    name: opts.name ?? opts.id,
    provider: opts.provider ?? 'test-provider',
    modelId: opts.modelId ?? 'test-model',
    costTier: opts.costTier ?? 'standard',
    capabilities: opts.capabilities ?? [],
    isLocal: opts.isLocal ?? false,
    maxTokens: opts.maxTokens ?? 4096,
    available: opts.available ?? true,
    ...opts,
  };
}

function createMockRule(opts: Partial<RouteRule> & { id: string; preferredModels: string[] }): RouteRule {
  return {
    taskPattern: opts.taskPattern ?? '*',
    maxCostTier: opts.maxCostTier ?? 'expensive',
    minQuality: opts.minQuality ?? 'low',
    allowFallback: opts.allowFallback ?? true,
    keywordPatterns: opts.keywordPatterns ?? [],
    ...opts,
  };
}

function registerPassthroughOutbound(
  registry: TransformerRegistry,
  providerId: string,
): void {
  registry.registerOutbound(providerId, {
    name: providerId,
    transformRequest: (_req: InternalLLMRequest) => ({ transformed: true }),
    transformResponse: (_res: unknown) => ({
      content: 'transformed',
      model: 'test-model',
      finishReason: 'stop' as const,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    }),
  });
}

// ── Tests ─────────────────────────────────────────────────

describe('Router + ModelRouter integration', () => {
  beforeEach(() => {
    resetCircuitBreakerV2();
  });

  // ── 1. Router with ModelRouter: routes task to preferred endpoint ──

  it('routes task to preferred endpoint when ModelRouter is enabled', async () => {
    const router = new Router();
    let preferredRequest: GenerateRequest | undefined;
    const preferred = createMockProvider({
      id: 'preferred',
      name: 'Preferred',
      type: 'api',
      models: [{ id: 'preferred-model', name: 'Preferred Model', provider: 'preferred', maxTokens: 4096 }],
      response: { text: 'from-preferred', provider: 'preferred', model: 'preferred-model', resolvedProvider: 'preferred', resolvedModel: 'preferred-model', fallbackUsed: false },
      onGenerate: (request) => {
        preferredRequest = request;
      },
    });
    const fallback = createMockProvider({
      id: 'fallback',
      name: 'Fallback',
      type: 'api',
      models: [{ id: 'fallback-model', name: 'Fallback Model', provider: 'fallback', maxTokens: 4096 }],
      response: { text: 'from-fallback', provider: 'fallback', model: 'fallback-model', resolvedProvider: 'fallback', resolvedModel: 'fallback-model', fallbackUsed: false },
    });

    router.register(preferred);
    router.register(fallback);

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: 'preferred-endpoint', provider: 'preferred', modelId: 'preferred-model' }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['preferred-endpoint'] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({ enabled: true, decision });
    router.setModelRouter(mockRouter);

    // "summarize this" triggers summarization task
    const result = await router.generate({ prompt: 'summarize this' });

    assert.equal(result.text, 'from-preferred');
    assert.equal(result.provider, 'preferred');
    assert.equal(result.fallbackUsed, false);
    assert.equal(preferredRequest?.provider, 'preferred');
    assert.equal(preferredRequest?.model, 'preferred-model');
    assert.deepEqual(result.routing, {
      strategy: 'model-router',
      classification: {
        task: 'summarization',
        confidence: 0.75,
        shouldOffload: true,
        reason: 'Matched 1 keyword(s) for summarization',
      },
      matchedRuleId: 'rule-1',
      selectedEndpointId: 'preferred-endpoint',
      attemptedProviders: ['preferred'],
      decisionReason: 'Primary model for summarization',
    });
  });

  it('routes correctly when endpoint.id differs from provider.id', async () => {
    const router = new Router();
    let selectedRequest: GenerateRequest | undefined;
    const selected = createMockProvider({
      id: 'anthropic',
      name: 'Anthropic',
      type: 'api',
      models: [{ id: 'claude-3-7-sonnet-latest', name: 'Claude', provider: 'anthropic', maxTokens: 4096 }],
      response: { text: 'from-anthropic', provider: 'anthropic', model: 'claude-3-7-sonnet-latest', resolvedProvider: 'anthropic', resolvedModel: 'claude-3-7-sonnet-latest', fallbackUsed: false },
      onGenerate: (request) => {
        selectedRequest = request;
      },
    });
    const fallback = createMockProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'api',
      models: [{ id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', maxTokens: 4096 }],
      response: { text: 'from-openai', provider: 'openai', model: 'gpt-4.1', resolvedProvider: 'openai', resolvedModel: 'gpt-4.1', fallbackUsed: false },
    });

    router.register(fallback);
    router.register(selected);

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({
        id: 'anthropic-claude-3.7-sonnet',
        provider: 'anthropic',
        modelId: 'claude-3-7-sonnet-latest',
      }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['anthropic-claude-3.7-sonnet'] }),
      reason: 'Primary model for code',
      isFallback: false,
      costTier: 'standard',
    };

    router.setModelRouter(createMockModelRouter({ enabled: true, decision }));

    const result = await router.generate({ prompt: 'write a function' });

    assert.equal(result.provider, 'anthropic');
    assert.equal(result.model, 'claude-3-7-sonnet-latest');
    assert.equal(selectedRequest?.model, 'claude-3-7-sonnet-latest');
  });

  // ── 2. Router without ModelRouter: backward compatible behavior ──

  it('uses standard resolution when ModelRouter is not set', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'first',
      name: 'First',
      type: 'api',
      models: [{ id: 'model-a', name: 'Model A', provider: 'first', maxTokens: 4096 }],
      response: { text: 'from-first', provider: 'first', model: 'model-a', resolvedProvider: 'first', resolvedModel: 'model-a', fallbackUsed: false },
    }));
    router.register(createMockProvider({
      id: 'second',
      name: 'Second',
      type: 'api',
      models: [{ id: 'model-b', name: 'Model B', provider: 'second', maxTokens: 4096 }],
      response: { text: 'from-second', provider: 'second', model: 'model-b', resolvedProvider: 'second', resolvedModel: 'model-b', fallbackUsed: false },
    }));

    const result = await router.generate({ prompt: 'test' });

    assert.equal(result.text, 'from-first');
    assert.equal(result.provider, 'first');
    assert.equal(result.fallbackUsed, false);
  });

  it('uses standard resolution when ModelRouter is disabled', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'first',
      name: 'First',
      type: 'api',
      models: [{ id: 'model-a', name: 'Model A', provider: 'first', maxTokens: 4096 }],
      response: { text: 'from-first', provider: 'first', model: 'model-a', resolvedProvider: 'first', resolvedModel: 'model-a', fallbackUsed: false },
    }));

    const mockRouter = createMockModelRouter({ enabled: false, decision: null });
    router.setModelRouter(mockRouter);

    const result = await router.generate({ prompt: 'test' });

    assert.equal(result.text, 'from-first');
    assert.equal(result.provider, 'first');
  });

  // ── 3. ModelRouter endpoint not found: falls back to default ──

  it('falls back to default order when ModelRouter endpoint is not registered', async () => {
    const router = new Router();
    const first = createMockProvider({
      id: 'first',
      name: 'First',
      type: 'api',
      models: [{ id: 'model-a', name: 'Model A', provider: 'first', maxTokens: 4096 }],
      response: { text: 'from-first', provider: 'first', model: 'model-a', resolvedProvider: 'first', resolvedModel: 'model-a', fallbackUsed: false },
    });
    router.register(first);

    // ModelRouter wants 'unknown-endpoint' which is NOT registered
    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: 'unknown-endpoint' }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['unknown-endpoint'] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({ enabled: true, decision });
    router.setModelRouter(mockRouter);

    const result = await router.generate({ prompt: 'summarize this' });

    // Should fall back to standard resolution (first provider)
    assert.equal(result.text, 'from-first');
    assert.equal(result.provider, 'first');
    // fallbackUsed is false because the first provider is tried at index 0
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.routing?.strategy, 'standard');
    assert.equal(result.routing?.matchedRuleId, undefined);
    assert.equal(result.routing?.selectedEndpointId, undefined);
    assert.equal(result.routing?.decisionReason, 'Resolved by standard provider ordering');
  });

  it('falls back to default order when ModelRouter provider cannot be resolved', async () => {
    const router = new Router();
    const first = createMockProvider({
      id: 'first',
      name: 'First',
      type: 'api',
      models: [{ id: 'model-a', name: 'Model A', provider: 'first', maxTokens: 4096 }],
      response: { text: 'from-first', provider: 'first', model: 'model-a', resolvedProvider: 'first', resolvedModel: 'model-a', fallbackUsed: false },
    });
    router.register(first);

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({
        id: 'unmatched-endpoint',
        provider: 'missing-provider',
        modelId: 'missing-model',
      }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['unmatched-endpoint'] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    router.setModelRouter(createMockModelRouter({ enabled: true, decision }));

    const result = await router.generate({ prompt: 'summarize this' });

    assert.equal(result.text, 'from-first');
    assert.equal(result.provider, 'first');
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.routing?.strategy, 'standard');
    assert.equal(result.routing?.matchedRuleId, undefined);
    assert.equal(result.routing?.selectedEndpointId, undefined);
    assert.equal(result.routing?.decisionReason, 'Resolved by standard provider ordering');
  });

  // ── 4. Feedback recorded on success ──

  it('records feedback on successful generation via ModelRouter', async () => {
    const router = new Router();
    const endpointId = 'smart-endpoint';
    const providerId = 'smart-provider';
    router.register(createMockProvider({
      id: providerId,
      name: 'Smart',
      type: 'api',
      models: [{ id: 'smart-model', name: 'Smart Model', provider: providerId, maxTokens: 4096 }],
      response: { text: 'smart-response', provider: providerId, model: 'smart-model', resolvedProvider: providerId, resolvedModel: 'smart-model', fallbackUsed: false },
    }));

    const feedbacks: Array<{
      endpointId: string;
      selectedEndpointId?: string;
      taskPattern: string;
      acceptable: boolean;
      latencyMs: number;
    }> = [];

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: endpointId, provider: providerId, modelId: 'smart-model' }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: [endpointId] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({
      enabled: true,
      decision,
      onRecordFeedback: (fb) => feedbacks.push(fb),
    });
    router.setModelRouter(mockRouter);

    await router.generate({ prompt: 'summarize this' });

    assert.equal(feedbacks.length, 1);
    assert.equal(feedbacks[0]!.endpointId, endpointId);
    assert.equal(feedbacks[0]!.selectedEndpointId, endpointId);
    assert.equal(feedbacks[0]!.taskPattern, 'summarization');
    assert.equal(feedbacks[0]!.acceptable, true);
    assert.ok(typeof feedbacks[0]!.latencyMs === 'number');
    assert.ok(feedbacks[0]!.latencyMs >= 0);
  });

  // ── 5. Feedback recorded on failure ──

  it('records feedback on failed generation via ModelRouter', async () => {
    const router = new Router();
    const endpointId = 'failing-provider';
    router.register(createMockProvider({
      id: endpointId,
      name: 'Failing',
      type: 'api',
      models: [{ id: 'fail-model', name: 'Fail Model', provider: endpointId, maxTokens: 4096 }],
      shouldFail: true,
      failMessage: 'boom',
    }));
    router.register(createMockProvider({
      id: 'backup',
      name: 'Backup',
      type: 'api',
      models: [{ id: 'backup-model', name: 'Backup Model', provider: 'backup', maxTokens: 4096 }],
      response: { text: 'backup-response', provider: 'backup', model: 'backup-model', resolvedProvider: 'backup', resolvedModel: 'backup-model', fallbackUsed: false },
    }));

    const feedbacks: Array<{
      endpointId: string;
      selectedEndpointId?: string;
      taskPattern: string;
      acceptable: boolean;
      latencyMs: number;
    }> = [];

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: endpointId }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: [endpointId] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({
      enabled: true,
      decision,
      onRecordFeedback: (fb) => feedbacks.push(fb),
    });
    router.setModelRouter(mockRouter);

    // The first provider fails, fallback to backup succeeds
    const result = await router.generate({ prompt: 'summarize this' });

    assert.equal(result.provider, 'backup');
    assert.equal(result.fallbackUsed, true);

    // Two feedback entries: one for the failing provider, one for the backup
    assert.equal(feedbacks.length, 2);

    // First feedback is for the failing provider
    assert.equal(feedbacks[0]!.endpointId, endpointId);
    assert.equal(feedbacks[0]!.selectedEndpointId, endpointId);
    assert.equal(feedbacks[0]!.taskPattern, 'summarization');
    assert.equal(feedbacks[0]!.acceptable, false);

    // Second feedback is for the backup provider
    assert.equal(feedbacks[1]!.endpointId, 'backup');
    assert.equal(feedbacks[1]!.selectedEndpointId, endpointId);
    assert.equal(feedbacks[1]!.taskPattern, 'summarization');
    assert.equal(feedbacks[1]!.acceptable, true);
  });

  // ── 6. Feedback failure is non-blocking ──

  it('does not throw when feedback recording fails', async () => {
    const router = new Router();
    router.register(createMockProvider({
      id: 'good',
      name: 'Good',
      type: 'api',
      models: [{ id: 'good-model', name: 'Good Model', provider: 'good', maxTokens: 4096 }],
      response: { text: 'good-response', provider: 'good', model: 'good-model', resolvedProvider: 'good', resolvedModel: 'good-model', fallbackUsed: false },
    }));

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: 'good' }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['good'] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({
      enabled: true,
      decision,
      onRecordFeedback: () => {
        throw new Error('feedback storage is down');
      },
    });
    router.setModelRouter(mockRouter);

    // Should not throw despite feedback failure
    const result = await router.generate({ prompt: 'summarize this' });

    assert.equal(result.text, 'good-response');
    assert.equal(result.provider, 'good');
  });

  // ── 7. Precedence: local-llm vs ModelRouter ──

  it('ModelRouter takes precedence over local-llm offloading', async () => {
    const router = new Router();
    const cloudProvider = createMockProvider({
      id: 'cloud',
      name: 'Cloud',
      type: 'api',
      models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
      response: { text: 'from-cloud', provider: 'cloud', model: 'cloud-model', resolvedProvider: 'cloud', resolvedModel: 'cloud-model', fallbackUsed: false },
    });
    const localProvider = createMockProvider({
      id: 'local-llm',
      name: 'Local LLM',
      type: 'cli',
      models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
      response: { text: 'from-local', provider: 'local-llm', model: 'local-model', resolvedProvider: 'local-llm', resolvedModel: 'local-model', fallbackUsed: false },
    });

    router.register(cloudProvider);
    router.register(localProvider);

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: 'cloud-endpoint', provider: 'cloud', modelId: 'cloud-model' }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['cloud-endpoint'] }),
      reason: 'Primary model for fast-completion',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({ enabled: true, decision });
    router.setModelRouter(mockRouter);

    // Short prompt "hi" stays on the unified classifier's fast-completion path,
    // so routing should remain with the cloud provider.
    const result = await router.generate({ prompt: 'hi' });

    assert.equal(result.text, 'from-cloud');
    assert.equal(result.provider, 'cloud');
    assert.equal(result.fallbackUsed, false);
  });

  it('local-llm offloading works when ModelRouter is disabled', async () => {
    const router = new Router();
    const cloudProvider = createMockProvider({
      id: 'cloud',
      name: 'Cloud',
      type: 'api',
      models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
      response: { text: 'from-cloud', provider: 'cloud', model: 'cloud-model', resolvedProvider: 'cloud', resolvedModel: 'cloud-model', fallbackUsed: false },
    });
    const localProvider = createMockProvider({
      id: 'local-llm',
      name: 'Local LLM',
      type: 'cli',
      models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
      response: { text: 'from-local', provider: 'local-llm', model: 'local-model', resolvedProvider: 'local-llm', resolvedModel: 'local-model', fallbackUsed: false },
    });

    router.register(cloudProvider);
    router.register(localProvider);

    const mockRouter = createMockModelRouter({ enabled: false, decision: null });
    router.setModelRouter(mockRouter);

    // "summarize this" is recognized as offloadable by classifyForOffload
    const result = await router.generate({ prompt: 'summarize this' });

    assert.equal(result.text, 'from-local');
    assert.equal(result.provider, 'local-llm');
    assert.equal(result.fallbackUsed, false);
  });

  it('local-llm offloading works when ModelRouter returns null', async () => {
    const router = new Router();
    const cloudProvider = createMockProvider({
      id: 'cloud',
      name: 'Cloud',
      type: 'api',
      models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
      response: { text: 'from-cloud', provider: 'cloud', model: 'cloud-model', resolvedProvider: 'cloud', resolvedModel: 'cloud-model', fallbackUsed: false },
    });
    const localProvider = createMockProvider({
      id: 'local-llm',
      name: 'Local LLM',
      type: 'cli',
      models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
      response: { text: 'from-local', provider: 'local-llm', model: 'local-model', resolvedProvider: 'local-llm', resolvedModel: 'local-model', fallbackUsed: false },
    });

    router.register(cloudProvider);
    router.register(localProvider);

    const mockRouter = createMockModelRouter({ enabled: true, decision: null });
    router.setModelRouter(mockRouter);

    // "summarize this" is recognized as offloadable by classifyForOffload
    const result = await router.generate({ prompt: 'summarize this' });

    assert.equal(result.text, 'from-local');
    assert.equal(result.provider, 'local-llm');
    assert.equal(result.fallbackUsed, false);
  });

  it('does not give local-llm precedence to short generic prompts', async () => {
    const router = new Router();
    const cloudProvider = createMockProvider({
      id: 'cloud',
      name: 'Cloud',
      type: 'api',
      models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
      response: { text: 'from-cloud', provider: 'cloud', model: 'cloud-model', resolvedProvider: 'cloud', resolvedModel: 'cloud-model', fallbackUsed: false },
    });
    const localProvider = createMockProvider({
      id: 'local-llm',
      name: 'Local LLM',
      type: 'cli',
      models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
      response: { text: 'from-local', provider: 'local-llm', model: 'local-model', resolvedProvider: 'local-llm', resolvedModel: 'local-model', fallbackUsed: false },
    });

    router.register(cloudProvider);
    router.register(localProvider);
    router.setModelRouter(createMockModelRouter({ enabled: false, decision: null }));

    const result = await router.generate({ prompt: 'hi' });

    assert.equal(result.text, 'from-cloud');
    assert.equal(result.provider, 'cloud');
    assert.equal(result.fallbackUsed, false);
  });

  // ── 8. generateFromInternal integration ──

  it('generateFromInternal routes via ModelRouter when enabled', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();

    const endpointId = 'internal-endpoint';
    const providerId = 'internal-provider';
    let providerRequest: GenerateRequest | undefined;
    const provider = createMockProvider({
      id: providerId,
      name: 'Internal Provider',
      type: 'api',
      models: [{ id: 'internal-model', name: 'Internal Model', provider: providerId, maxTokens: 4096 }],
      response: { text: 'internal-response', provider: providerId, model: 'internal-model', resolvedProvider: providerId, resolvedModel: 'internal-model', fallbackUsed: false },
      onGenerate: (request) => {
        providerRequest = request;
      },
    });

    router.register(provider);
    router.setTransformerRegistry(registry);

    // Register a mock outbound transformer so tryProvider finds one
    registry.registerOutbound(providerId, {
      name: providerId,
      transformRequest: (_req: InternalLLMRequest) => ({ transformed: true }),
      transformResponse: (_res: unknown) => ({
        content: 'transformed',
        model: 'internal-model',
        finishReason: 'stop' as const,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    });

    const feedbacks: Array<{ endpointId: string; taskPattern: string; acceptable: boolean; latencyMs: number }> = [];

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: endpointId, provider: providerId, modelId: 'internal-model' }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: [endpointId] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({
      enabled: true,
      decision,
      onRecordFeedback: (fb) => feedbacks.push(fb),
    });
    router.setModelRouter(mockRouter);

    const request: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'internal-model',
    };

    const result = await router.generateFromInternal(request);

    assert.equal(result.content, 'internal-response');
    assert.equal(result.metadata?.['provider'], providerId);
    assert.equal(providerRequest?.model, 'internal-model');

    assert.equal(feedbacks.length, 1);
    assert.equal(feedbacks[0]!.endpointId, endpointId);
    assert.equal(feedbacks[0]!.taskPattern, 'summarization');
    assert.equal(feedbacks[0]!.acceptable, true);
  });

  it('generateFromInternal falls back to standard order when ModelRouter is disabled', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();

    const first = createMockProvider({
      id: 'first',
      name: 'First',
      type: 'api',
      models: [{ id: 'first-model', name: 'First Model', provider: 'first', maxTokens: 4096 }],
      response: { text: 'first-response', provider: 'first', model: 'first-model', resolvedProvider: 'first', resolvedModel: 'first-model', fallbackUsed: false },
    });

    router.register(first);
    router.setTransformerRegistry(registry);

    registry.registerOutbound('first', {
      name: 'first',
      transformRequest: (_req: InternalLLMRequest) => ({ transformed: true }),
      transformResponse: (_res: unknown) => ({
        content: 'transformed',
        model: 'first-model',
        finishReason: 'stop' as const,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    });

    const mockRouter = createMockModelRouter({ enabled: false, decision: null });
    router.setModelRouter(mockRouter);

    const request: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'hello' }],
      model: 'first-model',
    };

    const result = await router.generateFromInternal(request);

    assert.equal(result.content, 'first-response');
    assert.equal(result.metadata?.['provider'], 'first');
  });

  it('generateFromInternal does not use ModelRouter when request specifies provider', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    let routeCalls = 0;

    const alpha = createMockProvider({
      id: 'alpha',
      name: 'Alpha',
      type: 'api',
      models: [{ id: 'alpha-model', name: 'Alpha Model', provider: 'alpha', maxTokens: 4096 }],
      response: { text: 'alpha-response', provider: 'alpha', model: 'alpha-model', resolvedProvider: 'alpha', resolvedModel: 'alpha-model', fallbackUsed: false },
    });
    const beta = createMockProvider({
      id: 'beta',
      name: 'Beta',
      type: 'api',
      models: [{ id: 'beta-model', name: 'Beta Model', provider: 'beta', maxTokens: 4096 }],
      response: { text: 'beta-response', provider: 'beta', model: 'beta-model', resolvedProvider: 'beta', resolvedModel: 'beta-model', fallbackUsed: false },
    });

    router.register(alpha);
    router.register(beta);
    router.setTransformerRegistry(registry);

    registry.registerOutbound('alpha', {
      name: 'alpha',
      transformRequest: (_req: InternalLLMRequest) => ({ transformed: true }),
      transformResponse: (_res: unknown) => ({
        content: 'transformed',
        model: 'alpha-model',
        finishReason: 'stop' as const,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    });
    registry.registerOutbound('beta', {
      name: 'beta',
      transformRequest: (_req: InternalLLMRequest) => ({ transformed: true }),
      transformResponse: (_res: unknown) => ({
        content: 'transformed',
        model: 'beta-model',
        finishReason: 'stop' as const,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    });

    // ModelRouter wants beta
    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: 'beta' }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['beta'] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({
      enabled: true,
      decision,
      onRoute: () => {
        routeCalls++;
      },
    });
    router.setModelRouter(mockRouter);

    // Request specifies alpha in metadata
    const request: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'alpha-model',
      metadata: { provider: 'alpha' },
    };

    const result = await router.generateFromInternal(request);

    assert.equal(result.content, 'alpha-response');
    assert.equal(result.metadata?.['provider'], 'alpha');
    assert.equal(routeCalls, 0);
  });

  it('keeps explicit provider authoritative across generateFromInternal and streaming when the model conflicts', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    let routeCalls = 0;
    let alphaInternalRequest: GenerateRequest | undefined;

    const alpha = createMockProvider({
      id: 'alpha',
      name: 'Alpha',
      type: 'api',
      models: [{ id: 'alpha-model', name: 'Alpha Model', provider: 'alpha', maxTokens: 4096 }],
      response: {
        text: 'alpha-response',
        provider: 'alpha',
        model: 'beta-model',
        resolvedProvider: 'alpha',
        resolvedModel: 'beta-model',
        fallbackUsed: false,
      },
      onGenerate: (request) => {
        alphaInternalRequest = request;
      },
    });
    const beta = createMockProvider({
      id: 'beta',
      name: 'Beta',
      type: 'api',
      models: [{ id: 'beta-model', name: 'Beta Model', provider: 'beta', maxTokens: 4096 }],
      response: {
        text: 'beta-response',
        provider: 'beta',
        model: 'beta-model',
        resolvedProvider: 'beta',
        resolvedModel: 'beta-model',
        fallbackUsed: false,
      },
    });

    router.register(alpha);
    router.register(beta);
    router.setTransformerRegistry(registry);
    registerPassthroughOutbound(registry, 'alpha');
    registerPassthroughOutbound(registry, 'beta');
    registry.registerStreamOutbound('alpha', {
      name: 'alpha',
      async *transformStream() {
        yield { content: '', done: true };
      },
    });
    registry.registerStreamOutbound('beta', {
      name: 'beta',
      async *transformStream() {
        yield { content: '', done: true };
      },
    });

    router.setModelRouter(createMockModelRouter({
      enabled: true,
      decision: {
        endpoint: createMockEndpoint({ id: 'beta-endpoint', provider: 'beta', modelId: 'beta-model' }),
        matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['beta-endpoint'] }),
        reason: 'Primary model for summarization',
        isFallback: false,
        costTier: 'standard',
      },
      onRoute: () => {
        routeCalls++;
      },
    }));

    const internal = await router.generateFromInternal({
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'beta-model',
      metadata: { provider: 'alpha', strict: true },
    });
    const streamingCandidates = await router.resolveStreamingProviders({
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'beta-model',
      metadata: { provider: 'alpha', strict: true },
    });

    assert.equal(internal.metadata?.['provider'], 'alpha');
    assert.equal(alphaInternalRequest?.provider, 'alpha');
    assert.equal(alphaInternalRequest?.model, 'beta-model');
    assert.equal(streamingCandidates[0]?.provider.id, 'alpha');
    assert.equal(streamingCandidates[0]?.request.model, 'beta-model');
    assert.equal(streamingCandidates.length, 1);
    assert.equal(routeCalls, 0);
  });

  it('strict internal routing fails when an explicit provider is breaker-blocked and does not expose backups', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();

    router.register(createMockProvider({
      id: 'alpha',
      name: 'Alpha',
      type: 'api',
      models: [{ id: 'shared-model', name: 'Shared Model', provider: 'alpha', maxTokens: 4096 }],
      response: {
        text: 'alpha-response',
        provider: 'alpha',
        model: 'shared-model',
        resolvedProvider: 'alpha',
        resolvedModel: 'shared-model',
        fallbackUsed: false,
      },
    }));
    router.register(createMockProvider({
      id: 'beta',
      name: 'Beta',
      type: 'api',
      models: [{ id: 'shared-model', name: 'Shared Model', provider: 'beta', maxTokens: 4096 }],
      response: {
        text: 'beta-response',
        provider: 'beta',
        model: 'shared-model',
        resolvedProvider: 'beta',
        resolvedModel: 'shared-model',
        fallbackUsed: false,
      },
    }));
    router.setTransformerRegistry(registry);
    registerPassthroughOutbound(registry, 'alpha');
    registerPassthroughOutbound(registry, 'beta');
    registry.registerStreamOutbound('alpha', {
      name: 'alpha',
      async *transformStream() {
        yield { content: '', done: true };
      },
    });
    registry.registerStreamOutbound('beta', {
      name: 'beta',
      async *transformStream() {
        yield { content: '', done: true };
      },
    });

    const previousFlag = process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'];
    process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] = 'true';

    try {
      const circuitBreaker = getCircuitBreakerV2();
      for (let index = 0; index < 5; index++) {
        circuitBreaker.recordFailure('alpha', 'default', 'shared-model');
      }

      await assert.rejects(
        () => router.generateFromInternal({
          messages: [{ role: 'user', content: 'summarize this' }],
          model: 'shared-model',
          metadata: { provider: 'alpha', strict: true },
        }),
        /Strict mode candidate alpha is blocked by an open circuit breaker/,
      );

      await assert.rejects(
        () => router.resolveStreamingProviders({
          messages: [{ role: 'user', content: 'summarize this' }],
          model: 'shared-model',
          metadata: { provider: 'alpha', strict: true },
        }),
        /Strict mode candidate alpha is blocked by an open circuit breaker/,
      );
    } finally {
      if (previousFlag === undefined) {
        delete process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'];
      } else {
        process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] = previousFlag;
      }
    }
  });

  it('generateFromInternal falls back when ModelRouter endpoint not found', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();

    const first = createMockProvider({
      id: 'first',
      name: 'First',
      type: 'api',
      models: [{ id: 'first-model', name: 'First Model', provider: 'first', maxTokens: 4096 }],
      response: { text: 'first-response', provider: 'first', model: 'first-model', resolvedProvider: 'first', resolvedModel: 'first-model', fallbackUsed: false },
    });

    router.register(first);
    router.setTransformerRegistry(registry);

    registry.registerOutbound('first', {
      name: 'first',
      transformRequest: (_req: InternalLLMRequest) => ({ transformed: true }),
      transformResponse: (_res: unknown) => ({
        content: 'transformed',
        model: 'first-model',
        finishReason: 'stop' as const,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    });

    const decision: RoutingDecision = {
      endpoint: createMockEndpoint({ id: 'missing-endpoint' }),
      matchedRule: createMockRule({ id: 'rule-1', preferredModels: ['missing-endpoint'] }),
      reason: 'Primary model for summarization',
      isFallback: false,
      costTier: 'standard',
    };

    const mockRouter = createMockModelRouter({ enabled: true, decision });
    router.setModelRouter(mockRouter);

    const request: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'first-model',
    };

    const result = await router.generateFromInternal(request);

    assert.equal(result.content, 'first-response');
    assert.equal(result.metadata?.['provider'], 'first');
  });

  it('generateFromInternal applies local-llm precedence for offloadable prompts', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    const callOrder: string[] = [];

    const cloudProvider = createMockProvider({
      id: 'cloud',
      name: 'Cloud',
      type: 'api',
      models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
      response: {
        text: 'cloud-response',
        provider: 'cloud',
        model: 'cloud-model',
        resolvedProvider: 'cloud',
        resolvedModel: 'cloud-model',
        fallbackUsed: false,
      },
      onGenerate: () => {
        callOrder.push('cloud');
      },
    });
    const localProvider = createMockProvider({
      id: 'local-llm',
      name: 'Local LLM',
      type: 'api',
      models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
      response: {
        text: 'local-response',
        provider: 'local-llm',
        model: 'local-model',
        resolvedProvider: 'local-llm',
        resolvedModel: 'local-model',
        fallbackUsed: false,
      },
      onGenerate: () => {
        callOrder.push('local-llm');
      },
    });

    router.register(cloudProvider);
    router.register(localProvider);
    router.setTransformerRegistry(registry);
    router.setModelRouter(createMockModelRouter({ enabled: true, decision: null }));
    registerPassthroughOutbound(registry, 'cloud');
    registerPassthroughOutbound(registry, 'local-llm');

    const result = await router.generateFromInternal({
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'cloud-model',
    });

    assert.equal(result.content, 'local-response');
    assert.equal(result.metadata?.['provider'], 'local-llm');
    assert.deepEqual(callOrder, ['local-llm']);
  });

  it('generateFromInternal falls back to cloud when local-llm fails', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    const callOrder: string[] = [];

    const localProvider = createMockProvider({
      id: 'local-llm',
      name: 'Local LLM',
      type: 'api',
      models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
      onGenerate: () => {
        callOrder.push('local-llm');
      },
    });
    localProvider.generate = async () => {
      callOrder.push('local-llm');
      throw new LocalLLMError('ollama unavailable', 'ollama');
    };

    const cloudProvider = createMockProvider({
      id: 'cloud',
      name: 'Cloud',
      type: 'api',
      models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
      response: {
        text: 'cloud-fallback-response',
        provider: 'cloud',
        model: 'cloud-model',
        resolvedProvider: 'cloud',
        resolvedModel: 'cloud-model',
        fallbackUsed: false,
      },
      onGenerate: () => {
        callOrder.push('cloud');
      },
    });

    router.register(cloudProvider);
    router.register(localProvider);
    router.setTransformerRegistry(registry);
    router.setModelRouter(createMockModelRouter({ enabled: true, decision: null }));
    registerPassthroughOutbound(registry, 'cloud');
    registerPassthroughOutbound(registry, 'local-llm');

    const result = await router.generateFromInternal({
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'cloud-model',
    });

    assert.equal(result.content, 'cloud-fallback-response');
    assert.equal(result.metadata?.['provider'], 'cloud');
    assert.deepEqual(callOrder, ['local-llm', 'cloud']);
  });

  it('generateFromInternal preserves optimized request shaping on the local path', async () => {
    const savedOptimizeMessages = process.env['OPTIMIZE_MESSAGES_ENABLED'];
    process.env['OPTIMIZE_MESSAGES_ENABLED'] = 'true';

    try {
      const router = new Router();
      const registry = new TransformerRegistry();
      let localRequest: GenerateRequest | undefined;

      const cloudProvider = createMockProvider({
        id: 'cloud',
        name: 'Cloud',
        type: 'api',
        models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
      });
      const localProvider = createMockProvider({
        id: 'local-llm',
        name: 'Local LLM',
        type: 'api',
        models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
        response: {
          text: 'local-response',
          provider: 'local-llm',
          model: 'local-model',
          resolvedProvider: 'local-llm',
          resolvedModel: 'local-model',
          fallbackUsed: false,
        },
        onGenerate: (request) => {
          localRequest = request;
        },
      });

      router.register(cloudProvider);
      router.register(localProvider);
      router.setTransformerRegistry(registry);
      router.setModelRouter(createMockModelRouter({ enabled: true, decision: null }));
      registerPassthroughOutbound(registry, 'cloud');
      registerPassthroughOutbound(registry, 'local-llm');

      await router.generateFromInternal({
        model: 'cloud-model',
        messages: [
          {
            role: 'user',
            content:
              'You are an expert in TypeScript.\n\nContext: We use strict mode.\n\nTask: summarize this generic helper.',
          },
        ],
      });

      assert.ok(localRequest);
      assert.ok(localRequest.system);
      assert.match(localRequest.system ?? '', /TypeScript/);
      assert.match(localRequest.prompt, /summarize this generic helper/i);
    } finally {
      if (savedOptimizeMessages === undefined) {
        delete process.env['OPTIMIZE_MESSAGES_ENABLED'];
      } else {
        process.env['OPTIMIZE_MESSAGES_ENABLED'] = savedOptimizeMessages;
      }
    }
  });

  it('keeps offload decisions consistent between generate and generateFromInternal', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    const offloadCalls: string[] = [];
    const complexCalls: string[] = [];

    const cloudProvider = createMockProvider({
      id: 'cloud',
      name: 'Cloud',
      type: 'api',
      models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
      response: {
        text: 'cloud-response',
        provider: 'cloud',
        model: 'cloud-model',
        resolvedProvider: 'cloud',
        resolvedModel: 'cloud-model',
        fallbackUsed: false,
      },
      onGenerate: (request) => {
        if (request.prompt.includes('security audit')) {
          complexCalls.push('cloud');
        } else {
          offloadCalls.push('cloud');
        }
      },
    });
    const localProvider = createMockProvider({
      id: 'local-llm',
      name: 'Local LLM',
      type: 'api',
      models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
      response: {
        text: 'local-response',
        provider: 'local-llm',
        model: 'local-model',
        resolvedProvider: 'local-llm',
        resolvedModel: 'local-model',
        fallbackUsed: false,
      },
      onGenerate: (request) => {
        if (request.prompt.includes('security audit')) {
          complexCalls.push('local-llm');
        } else {
          offloadCalls.push('local-llm');
        }
      },
    });

    router.register(cloudProvider);
    router.register(localProvider);
    router.setTransformerRegistry(registry);
    registerPassthroughOutbound(registry, 'cloud');
    registerPassthroughOutbound(registry, 'local-llm');

    const legacyOffload = await router.generate({ prompt: 'summarize this' });
    const internalOffload = await router.generateFromInternal({
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'cloud-model',
    });
    const legacyComplex = await router.generate({ prompt: 'security audit and threat model' });
    const internalComplex = await router.generateFromInternal({
      messages: [{ role: 'user', content: 'security audit and threat model' }],
      model: 'cloud-model',
    });

    assert.equal(legacyOffload.provider, 'local-llm');
    assert.equal(internalOffload.metadata?.['provider'], 'local-llm');
    assert.equal(legacyComplex.provider, 'cloud');
    assert.equal(internalComplex.metadata?.['provider'], 'cloud');
    assert.deepEqual(offloadCalls, ['local-llm', 'local-llm']);
    assert.deepEqual(complexCalls, ['cloud', 'cloud']);
  });

  it('resolveStreamingProvider returns a success telemetry hook for ModelRouter feedback', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    const endpointId = 'stream-endpoint';
    const providerId = 'stream-provider';
    const feedbacks: Array<{ endpointId: string; taskPattern: string; acceptable: boolean; latencyMs: number }> = [];

    router.register(createMockProvider({
      id: providerId,
      name: 'Stream Provider',
      type: 'api',
      models: [{ id: 'stream-model', name: 'Stream Model', provider: providerId, maxTokens: 4096 }],
    }));
    router.setTransformerRegistry(registry);
    registry.registerStreamOutbound(providerId, {
      name: providerId,
      async *transformStream() {
        yield { content: '', done: true };
      },
    });

    router.setModelRouter(createMockModelRouter({
      enabled: true,
      decision: {
        endpoint: createMockEndpoint({ id: endpointId, provider: providerId, modelId: 'stream-model' }),
        matchedRule: createMockRule({ id: 'rule-1', preferredModels: [endpointId] }),
        reason: 'Primary model for summarization',
        isFallback: false,
        costTier: 'standard',
      },
      onRecordFeedback: (feedback) => feedbacks.push(feedback),
    }));

    const resolved = await router.resolveStreamingProvider({
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'stream-model',
    });

    assert.ok(resolved);
    resolved?.recordResult({
      model: 'stream-model',
      tokensIn: 3,
      tokensOut: 5,
      latencyMs: 42,
      success: true,
    });

    assert.equal(feedbacks.length, 1);
    assert.equal(feedbacks[0]!.endpointId, endpointId);
    assert.equal(feedbacks[0]!.taskPattern, 'summarization');
    assert.equal(feedbacks[0]!.acceptable, true);
    assert.equal(feedbacks[0]!.latencyMs, 42);
  });

  it('resolveStreamingProvider returns a failure telemetry hook for ModelRouter feedback', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();
    const endpointId = 'stream-endpoint';
    const providerId = 'stream-provider';
    const feedbacks: Array<{ endpointId: string; taskPattern: string; acceptable: boolean; latencyMs: number }> = [];

    router.register(createMockProvider({
      id: providerId,
      name: 'Stream Provider',
      type: 'api',
      models: [{ id: 'stream-model', name: 'Stream Model', provider: providerId, maxTokens: 4096 }],
    }));
    router.setTransformerRegistry(registry);
    registry.registerStreamOutbound(providerId, {
      name: providerId,
      async *transformStream() {
        yield { content: '', done: true };
      },
    });

    router.setModelRouter(createMockModelRouter({
      enabled: true,
      decision: {
        endpoint: createMockEndpoint({ id: endpointId, provider: providerId, modelId: 'stream-model' }),
        matchedRule: createMockRule({ id: 'rule-1', preferredModels: [endpointId] }),
        reason: 'Primary model for summarization',
        isFallback: false,
        costTier: 'standard',
      },
      onRecordFeedback: (feedback) => feedbacks.push(feedback),
    }));

    const resolved = await router.resolveStreamingProvider({
      messages: [{ role: 'user', content: 'summarize this' }],
      model: 'stream-model',
    });

    assert.ok(resolved);
    resolved?.recordResult({
      model: 'stream-model',
      latencyMs: 17,
      success: false,
      errorMessage: 'stream failed',
    });

    assert.equal(feedbacks.length, 1);
    assert.equal(feedbacks[0]!.endpointId, endpointId);
    assert.equal(feedbacks[0]!.taskPattern, 'summarization');
    assert.equal(feedbacks[0]!.acceptable, false);
    assert.equal(feedbacks[0]!.latencyMs, 17);
  });

  it('resolveStreamingProvider applies local-llm precedence when ModelRouter returns null', async () => {
    const router = new Router();
    const registry = new TransformerRegistry();

    const cloudProvider = createMockProvider({
      id: 'cloud',
      name: 'Cloud',
      type: 'api',
      models: [{ id: 'cloud-model', name: 'Cloud Model', provider: 'cloud', maxTokens: 4096 }],
    });
    const localProvider = createMockProvider({
      id: 'local-llm',
      name: 'Local LLM',
      type: 'cli',
      models: [{ id: 'local-model', name: 'Local Model', provider: 'local-llm', maxTokens: 4096 }],
    });

    router.register(cloudProvider);
    router.register(localProvider);
    router.setTransformerRegistry(registry);
    router.setModelRouter(createMockModelRouter({ enabled: true, decision: null }));

    registry.registerStreamOutbound('cloud', {
      name: 'cloud',
      async *transformStream() {
        yield { content: '', done: true };
      },
    });
    registry.registerStreamOutbound('local-llm', {
      name: 'local-llm',
      async *transformStream() {
        yield { content: '', done: true };
      },
    });

    const resolved = await router.resolveStreamingProvider({
      messages: [{ role: 'user', content: 'summarize this' }],
    });

    assert.ok(resolved);
    assert.equal(resolved?.provider.id, 'local-llm');
    assert.equal(resolved?.request.metadata?.provider, 'local-llm');
  });
});
