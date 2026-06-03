/**
 * Router — provider selection and fallback logic.
 *
 * Resolves which LLM provider to use based on the request's
 * preferred model/provider, falling back through available
 * candidates in priority order (API first, then CLI).
 *
 * When USE_TRANSFORMERS=true, the router can also accept
 * InternalLLMRequest payloads and use the transformer pipeline
 * for outbound conversion and response normalization.
 *
 * The legacy `generate()` path focuses on explicit provider/model routing,
 * ModelRouter/local-offload precedence, and fallback execution.
 * Richer group/session-aware routing is applied in the internal/streaming
 * paths built around `InternalLLMRequest`.
 */

import type {
  GenerateRequest,
  GenerateResponse,
  LLMProvider,
  ModelInfo,
} from './types.js';
import type { InternalLLMRequest, InternalLLMResponse } from './internal-model.js';
import type { TransformerRegistry } from './transformer.js';
import type { StreamingOutboundTransformer } from '../transformers/streaming.js';
import type { GroupStore } from './groups.js';
import type { SessionManager } from '../session/index.js';
import type { CostTracker } from './cost-tracker.js';
import type { FreeModelRouter } from '../free-models/router.js';
import type { LatencyMeasurer } from '../latency/measurer.js';
import type { ModelRouter } from '../model-routing/router.js';
import type { AnalyticsAggregator } from '../analytics/index.js';
import { LocalLLMError } from '../local-llm/client.js';
import type { ModelRouterStatsSnapshot } from '../model-routing/types.js';
import { prioritizeProviderCandidate } from './router-candidate-planner.js';
import {
  createAttemptTelemetryCallbacks,
  createStreamingRecordResult,
  recordLocalFallbackMetric,
  type RouterTelemetryContext,
} from './router-telemetry.js';
import { executeGenerateAttempt, tryProvider } from './router-executor.js';
import { buildInternalRoutingPlan } from './router-internal-plan.js';
import {
  buildRoutingPolicyPlan,
  determineDecisionReason,
  determineRoutingStrategy,
} from './router-policy-plan.js';
import {
  buildGenerateRequest,
  buildInternalRequest,
  type RoutingMetadataOptions,
  withInternalResolutionMetadata,
} from './router-shaping.js';
import {
  buildGenerateExecutionResponse,
  buildInternalResolutionMetadataOptions,
  createRouterExecutionContract,
  type RouterExecutionContract,
} from './router-execution-contract.js';
import {
  createProviderErrorAccumulator,
  throwAllProvidersFailed,
  tryCandidates,
} from './router-attempts.js';
import { optimizeMessagesEnabled } from './runtime-flags.js';

import { logger } from './logger.js';
import { CircuitBreakerV2 } from '../circuit-breaker/circuit-breaker-v2.js';

export interface ResolvedStreamingProvider {
  provider: LLMProvider;
  request: InternalLLMRequest;
  streamTransformer: StreamingOutboundTransformer;
  routingMetadata?: Omit<RoutingMetadataOptions, 'attemptedProviders'>;
  executionContract?: RouterExecutionContract;
  onSuccess?: () => void;
  recordResult: (input: {
    model?: string;
    totalTokens?: number;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs: number;
    success: boolean;
    attempt?: number;
    project?: string;
    errorMessage?: string;
  }) => void;
}

/**
 * Global Circuit Breaker V2 instance for per-(provider,key,model) granularity.
 * Used alongside the legacy registry for octopus-style circuit breaking.
 */
let circuitBreakerV2: CircuitBreakerV2 | null = null;

/**
 * Get the global Circuit Breaker V2 instance.
 */
export function getCircuitBreakerV2(): CircuitBreakerV2 {
  if (!circuitBreakerV2) {
    circuitBreakerV2 = new CircuitBreakerV2();
  }
  return circuitBreakerV2;
}

/**
 * Reset the global Circuit Breaker V2 instance (for testing).
 */
export function resetCircuitBreakerV2(): void {
  circuitBreakerV2 = null;
}

export { optimizeMessagesEnabled, useTransformers } from './runtime-flags.js';

export class Router {
  private _providers: LLMProvider[] = [];
  private _transformerRegistry: TransformerRegistry | null = null;
  private _groupStore: GroupStore | null = null;
  private _sessionManager: SessionManager | null = null;
  private _costTracker: CostTracker | null = null;
  private _freeModelRouter: FreeModelRouter | null = null;
  private _latencyMeasurer: LatencyMeasurer | null = null;
  private _modelRouter: ModelRouter | null = null;
  private _analyticsAggregator: AnalyticsAggregator | null = null;
  private _explorationRate: number = 0.1; // 10% epsilon-greedy

  /** Set the analytics aggregator for usage recording. */
  setAnalyticsAggregator(aggregator: AnalyticsAggregator): void {
    this._analyticsAggregator = aggregator;
  }

  /** Get the analytics aggregator (null if not set). */
  get analyticsAggregator(): AnalyticsAggregator | null {
    return this._analyticsAggregator;
  }

  /** Set the latency measurer for latency-based routing. */
  setLatencyMeasurer(measurer: LatencyMeasurer): void {
    this._latencyMeasurer = measurer;
  }

  /** Get the latency measurer (null if not set). */
  get latencyMeasurer(): LatencyMeasurer | null {
    return this._latencyMeasurer;
  }

  /** Set the exploration rate for epsilon-greedy routing (0-1). */
  setExplorationRate(rate: number): void {
    this._explorationRate = Math.max(0, Math.min(1, rate));
  }

  /** Get the exploration rate. */
  get explorationRate(): number {
    return this._explorationRate;
  }

  /** Set the cost tracker for usage recording. */
  setCostTracker(tracker: CostTracker): void {
    this._costTracker = tracker;
  }

  /** Get the cost tracker (null if not set). */
  get costTracker(): CostTracker | null {
    return this._costTracker;
  }

  /** Set the free model router for fallback strategy. */
  setFreeModelRouter(router: FreeModelRouter): void {
    this._freeModelRouter = router;
  }

  /** Get the free model router (null if not set). */
  get freeModelRouter(): FreeModelRouter | null {
    return this._freeModelRouter;
  }

  /** Set the transformer registry for the new pipeline. */
  setTransformerRegistry(registry: TransformerRegistry): void {
    this._transformerRegistry = registry;
  }

  /** Get the transformer registry (null if not set). */
  get transformerRegistry(): TransformerRegistry | null {
    return this._transformerRegistry;
  }

  /** Set the group store for group-based routing. */
  setGroupStore(store: GroupStore): void {
    this._groupStore = store;
  }

  /** Get the group store (null if not set). */
  get groupStore(): GroupStore | null {
    return this._groupStore;
  }

  /** Set the session manager for stickiness. */
  setSessionManager(manager: SessionManager): void {
    this._sessionManager = manager;
  }

  /** Get the session manager (null if not set). */
  get sessionManager(): SessionManager | null {
    return this._sessionManager;
  }

  /** Set the model router for cost-aware routing. */
  setModelRouter(router: ModelRouter): void {
    this._modelRouter = router;
  }

  /** Get the model router (null if not set). */
  get modelRouter(): ModelRouter | null {
    return this._modelRouter;
  }

  /** Return all registered providers. */
  get providers(): LLMProvider[] {
    return this._providers;
  }

  private getTelemetryContext(): RouterTelemetryContext {
    return {
      analyticsAggregator: this._analyticsAggregator,
      costTracker: this._costTracker,
      modelRouter: this._modelRouter,
    };
  }

  /** Register a provider adapter with the router. */
  register(provider: LLMProvider): void {
    this._providers.push(provider);
  }

  /**
   * Generate text by routing the request to the best available provider.
   *
   * Precedence stack for the legacy `GenerateRequest` path (highest to lowest):
   * 1. Explicit provider/model intent
   * 2. ModelRouter (when enabled and no explicit provider)
   * 3. Local-LLM offloading (when enabled and ModelRouter does not win)
   * 4. Standard resolution
   * 5. Latency reordering
   *
   * Tries each candidate in resolution order and falls back to the next
   * on failure. Throws if all providers fail.
   * Uses circuit breaker to skip providers that are currently failing.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    const telemetry = createAttemptTelemetryCallbacks(this.getTelemetryContext());
    const circuitBreaker = getCircuitBreakerV2();
    const plan = await buildRoutingPolicyPlan({
      providers: this._providers,
      request: {
        prompt: request.prompt,
        model: request.model,
        provider: request.provider,
        strict: request.strict === true,
      },
      groupStore: null,
      sessionManager: null,
      latencyMeasurer: this._latencyMeasurer,
      explorationRate: this._explorationRate,
      modelRouter: this._modelRouter,
      circuitBreaker,
      fallbackModel: 'unknown',
    });
    const candidates = plan.orderedCandidates;
    const routingMetadata = {
      strategy: determineRoutingStrategy({
        requestedProvider: request.provider,
        requestedModel: request.model,
        modelRouterDecision: plan.appliedModelRouterDecision,
        offloadClassification: plan.offloadClassification,
      }),
      classification: plan.classification ?? plan.offloadClassification,
      modelRouterDecision: plan.appliedModelRouterDecision,
      decisionReason: determineDecisionReason({
        requestedProvider: request.provider,
        requestedModel: request.model,
        modelRouterDecision: plan.appliedModelRouterDecision,
        offloadClassification: plan.offloadClassification,
      }),
    } satisfies Omit<RoutingMetadataOptions, 'attemptedProviders'>;
    const executionContract = createRouterExecutionContract({
      requestedProvider: request.provider,
      requestedModel: request.model,
      routingMetadata,
    });

    if (candidates.length === 0) {
      throw new Error(
        'No providers available. Store API credentials via vault_store or install a CLI tool.',
      );
    }

    if (plan.strict && plan.blockedStrictCandidate) {
      throw new Error(
        `Strict mode candidate ${plan.blockedStrictCandidate.id} is blocked by an open circuit breaker.`,
      );
    }

    if (plan.availableCandidates.length === 0) {
      // All candidates have open circuit breakers
      const openProviders = candidates.map((p) => p.id).join(', ');
      throw new Error(
        `All providers have circuit breakers open: ${openProviders}. Wait for recovery or check provider status.`,
      );
    }

    if (plan.strict) {
      const provider = plan.availableCandidates[0];

      if (!provider) {
        throw new Error(
          'No providers available. Store API credentials via vault_store or install a CLI tool.',
        );
      }

      executionContract.recordAttempt(provider.id);
      const result = await executeGenerateAttempt({
        provider,
        request: buildGenerateRequest(
          request,
          provider,
          plan.appliedModelRouterDecision?.endpoint,
        ),
        routedEndpoint: plan.appliedModelRouterDecision?.endpoint,
        circuitBreaker,
        defaultModel: plan.routedModel,
        classification: plan.classification,
        attempt: 1,
        ...telemetry,
        logFailure: ({ provider: failedProvider, attemptedModel, message }) => {
          logger.warn({ provider: failedProvider.id, model: attemptedModel, error: message }, 'Provider failed');
        },
      });
      return buildGenerateExecutionResponse(executionContract, {
        request,
        result,
        latencyMs: Date.now() - startTime,
      });
    }

    const providerErrors = createProviderErrorAccumulator();
    const attemptedResult = await tryCandidates(plan.availableCandidates, (provider, index) => {
      executionContract.recordAttempt(provider.id);
      return executeGenerateAttempt({
        provider,
        request: buildGenerateRequest(
          request,
          provider,
          plan.appliedModelRouterDecision?.endpoint,
        ),
        routedEndpoint: plan.appliedModelRouterDecision?.endpoint,
        circuitBreaker,
        defaultModel: plan.routedModel,
        classification: plan.classification,
        attempt: index + 1,
        ...telemetry,
        logFailure: ({ provider: failedProvider, attemptedModel, message, error }) => {
          if (error instanceof LocalLLMError) {
            logger.warn(
              {
                provider: failedProvider.id,
                model: attemptedModel,
                backend: error.backend,
                error: message,
              },
              'Local LLM failed — falling back to cloud provider',
            );
            recordLocalFallbackMetric(this.getTelemetryContext(), {
              attemptedModel,
              startTime,
              project: request.project,
              message,
            });
            return;
          }

          logger.warn({ provider: failedProvider.id, model: attemptedModel, error: message }, 'Provider failed');
        },
      });
    },
      (provider, error) => {
        providerErrors.add(provider, error);
      },
    );

    if (attemptedResult) {
      return buildGenerateExecutionResponse(executionContract, {
        request,
        result: attemptedResult.result,
        latencyMs: Date.now() - startTime,
      });
    }

    // Try free model fallback before giving up
    if (this._freeModelRouter?.isAvailable) {
      try {
        logger.info('All paid providers failed, attempting free model fallback');
        const freeResult = await this._freeModelRouter.generate(request);
        executionContract.recordAttempt('free-models');
        const freeModelExecutionContract = createRouterExecutionContract({
          requestedProvider: request.provider,
          requestedModel: request.model,
          routingMetadata: {
            ...routingMetadata,
            decisionReason: 'All paid providers failed; free model fallback succeeded',
          },
        });
        for (const providerId of executionContract.attemptedProviders) {
          freeModelExecutionContract.recordAttempt(providerId);
        }
        return buildGenerateExecutionResponse(
          freeModelExecutionContract,
          {
            request,
            result: freeResult,
            latencyMs: Date.now() - startTime,
          },
        );
      } catch (freeError) {
        providerErrors.errors.push(
          `free-models: ${freeError instanceof Error ? freeError.message : String(freeError)}`,
        );
      }
    }

    throwAllProvidersFailed(providerErrors.errors);
  }

  /**
   * Generate using the transformer pipeline (InternalLLMRequest → InternalLLMResponse).
   *
   * This is the new pipeline path, used when USE_TRANSFORMERS=true.
   *
   * Routing priority:
   * 1. Check session stickiness (if pinned, use that provider)
   * 2. Check if a Group matches the requested model (via modelPattern)
   *    → If group found, use group's balancer strategy to order providers
   * 3. ModelRouter selection (when enabled)
   * 4. Local-LLM offloading (only if ModelRouter did not select it)
   * 5. Standard resolution (provider preference → model match → fuzzy → API before CLI)
   * 6. Latency-based reordering
   *
   * After successful response: pin session if stickiness is enabled.
   */
  async generateFromInternal(request: InternalLLMRequest): Promise<InternalLLMResponse> {
    if (!this._transformerRegistry) {
      throw new Error('Transformer registry not configured. Call setTransformerRegistry() first.');
    }

    const registry = this._transformerRegistry;
    const circuitBreaker = getCircuitBreakerV2();
    const telemetry = createAttemptTelemetryCallbacks(this.getTelemetryContext());

    const plan = await buildInternalRoutingPlan({
      providers: this._providers,
      request,
      groupStore: this._groupStore,
      sessionManager: this._sessionManager,
      latencyMeasurer: this._latencyMeasurer,
      explorationRate: this._explorationRate,
      modelRouter: this._modelRouter,
      circuitBreaker,
      optimizeMessages: optimizeMessagesEnabled(),
    });
    const { optimizedRequest } = plan;

    const model = plan.model;
    const routingStrategy = determineRoutingStrategy({
      requestedProvider: plan.requestedProvider,
      requestedModel: request.model,
      modelRouterDecision: plan.appliedModelRouterDecision,
      offloadClassification: plan.offloadClassification,
    });
    const decisionReason = determineDecisionReason({
      requestedProvider: plan.requestedProvider,
      requestedModel: request.model,
      modelRouterDecision: plan.appliedModelRouterDecision,
      offloadClassification: plan.offloadClassification,
    });
    const executionContract = createRouterExecutionContract({
      requestedProvider: plan.requestedProvider,
      requestedModel: request.model,
      routingMetadata: {
        strategy: routingStrategy,
        classification: plan.classification ?? plan.offloadClassification,
        modelRouterDecision: plan.appliedModelRouterDecision,
        decisionReason,
      },
    });

    // 1. Check session stickiness
    if (plan.stickySession?.pinnedProviderId) {
      const stickyProvider = this._providers.find((p) => p.id === plan.stickySession?.pinnedProviderId);
      if (stickyProvider) {
        if (circuitBreaker.canExecute(stickyProvider.id, 'default', plan.routedModel).allowed) {
          try {
            executionContract.recordAttempt(stickyProvider.id);
            const result = await tryProvider({
              provider: stickyProvider,
              request: buildInternalRequest(
                optimizedRequest,
                stickyProvider,
                plan.appliedModelRouterDecision?.endpoint,
                ),
                registry,
                circuitBreaker,
                model: plan.routedModel,
                classification: plan.classification ?? undefined,
              attempt: 1,
                routedEndpoint: plan.appliedModelRouterDecision?.endpoint,
                ...telemetry,
            });
            return withInternalResolutionMetadata(
              result,
              buildInternalResolutionMetadataOptions(executionContract, {
                resolvedProvider: stickyProvider.id,
                resolvedModel: result.model,
              }),
            );
          } catch {
            // Sticky provider failed — fall through to normal routing
            logger.warn(
              {
                provider: stickyProvider.id,
                clientId: plan.stickySession.clientId,
                model,
              },
              'Sticky provider failed, falling through',
            );
          }
        }
      }
    }

    if (plan.orderedCandidates.length === 0) {
      throw new Error(
        'No providers available. Store API credentials via vault_store or install a CLI tool.',
      );
    }

    if (plan.strict && plan.blockedStrictCandidate) {
      throw new Error(
        `Strict mode candidate ${plan.blockedStrictCandidate.id} is blocked by an open circuit breaker.`,
      );
    }

    if (plan.availableCandidates.length === 0) {
      const openProviders = plan.orderedCandidates.map((provider) => provider.id).join(', ');
      throw new Error(
        `All providers have circuit breakers open: ${openProviders}. Wait for recovery or check provider status.`,
      );
    }

    const providerErrors = createProviderErrorAccumulator();
    const attemptedResult = await tryCandidates(plan.availableCandidates, (provider, index) => {
      executionContract.recordAttempt(provider.id);
      return tryProvider({
        provider,
        request: buildInternalRequest(
          optimizedRequest,
          provider,
          plan.appliedModelRouterDecision?.endpoint,
        ),
        registry,
        circuitBreaker,
        classification: plan.classification ?? undefined,
        attempt: index + 1,
        routedEndpoint: plan.appliedModelRouterDecision?.endpoint,
        ...telemetry,
      });
    },
      (provider, error) => {
        providerErrors.add(provider, error);
      },
    );

    if (attemptedResult) {
      // Pin session on success if stickiness is enabled
      if (this._sessionManager && plan.stickySession?.stickyTtlMs) {
        this._sessionManager.pinRouterStickySession(
          plan.stickySession.clientId,
          plan.stickySession.model,
          attemptedResult.provider.id,
          'default',
          plan.stickySession.stickyTtlMs,
        );
      }

      return withInternalResolutionMetadata(
        attemptedResult.result,
        buildInternalResolutionMetadataOptions(executionContract, {
          resolvedProvider: attemptedResult.provider.id,
          resolvedModel: attemptedResult.result.model,
        }),
      );
    }

    throwAllProvidersFailed(providerErrors.errors);
  }

  /**
   * Resolve the best available provider and its streaming transformer.
   *
   * Uses the same resolution logic as generateFromInternal (groups, balancer,
   * circuit breaker) but returns the resolved provider info so the HTTP layer
   * can drive the SSE streaming loop.
   *
   * Returns null if no provider has a streaming transformer registered.
   */
  async resolveStreamingProvider(
    request: InternalLLMRequest,
  ): Promise<ResolvedStreamingProvider | null> {
    const candidates = await this.resolveStreamingProviders(request);
    return candidates[0] ?? null;
  }

  /**
   * Resolve all ordered streaming-capable providers for this request.
   */
  async resolveStreamingProviders(
    request: InternalLLMRequest,
  ): Promise<ResolvedStreamingProvider[]> {
    if (!this._transformerRegistry) {
      return [];
    }

    const registry = this._transformerRegistry;
    const plan = await buildInternalRoutingPlan({
      providers: this._providers,
      request,
      groupStore: this._groupStore,
      sessionManager: this._sessionManager,
      latencyMeasurer: this._latencyMeasurer,
      explorationRate: this._explorationRate,
      modelRouter: this._modelRouter,
      circuitBreaker: getCircuitBreakerV2(),
      optimizeMessages: optimizeMessagesEnabled(),
    });

    if (plan.strict && plan.blockedStrictCandidate) {
      throw new Error(
        `Strict mode candidate ${plan.blockedStrictCandidate.id} is blocked by an open circuit breaker.`,
      );
    }

    const orderedStreamingCandidates = plan.stickySession?.pinnedProviderId
      ? prioritizeProviderCandidate(plan.availableCandidates, plan.stickySession.pinnedProviderId)
      : plan.availableCandidates;
    const routingMetadata = {
      strategy: determineRoutingStrategy({
        requestedProvider: plan.requestedProvider,
        requestedModel: request.model,
        modelRouterDecision: plan.appliedModelRouterDecision,
        offloadClassification: plan.offloadClassification,
      }),
      classification: plan.classification ?? plan.offloadClassification,
      modelRouterDecision: plan.appliedModelRouterDecision,
      decisionReason: determineDecisionReason({
        requestedProvider: plan.requestedProvider,
        requestedModel: request.model,
        modelRouterDecision: plan.appliedModelRouterDecision,
        offloadClassification: plan.offloadClassification,
      }),
    } satisfies Omit<RoutingMetadataOptions, 'attemptedProviders'>;
    const executionContract = createRouterExecutionContract({
      requestedProvider: plan.requestedProvider,
      requestedModel: request.model,
      routingMetadata,
    });
    const resolvedProviders: ResolvedStreamingProvider[] = [];

    for (const provider of orderedStreamingCandidates) {
      const streamTransformer = registry.getStreamOutbound(provider.id);
      if (streamTransformer) {
        const routedEndpoint = plan.appliedModelRouterDecision?.endpoint;
        const stickySession = plan.stickySession;
        const stickyTtlMs = stickySession?.stickyTtlMs ?? null;
        resolvedProviders.push({
          provider,
          request: buildInternalRequest(
            plan.optimizedRequest,
            provider,
            routedEndpoint,
          ),
          streamTransformer,
          routingMetadata,
          executionContract,
          onSuccess:
            this._sessionManager && stickySession && stickyTtlMs !== null
              ? () => {
                  this._sessionManager?.pinRouterStickySession(
                    stickySession.clientId,
                    stickySession.model,
                    provider.id,
                    'default',
                    stickyTtlMs,
                  );
                }
              : undefined,
          recordResult: createStreamingRecordResult({
            telemetry: this.getTelemetryContext(),
            provider,
            requestModel: request.model,
            routedEndpoint,
            classification: plan.classification,
          }),
        });
      }
    }

    return resolvedProviders;
  }

  /** Return models from all registered providers. */
  async getAvailableModels(): Promise<ModelInfo[]> {
    // Parallel availability checks for better performance
    const results = await Promise.all(
      this._providers.map(async (provider) => ({
        provider,
        available: await provider.isAvailable(),
      })),
    );

    return results
      .filter((r) => r.available)
      .flatMap((r) => r.provider.models);
  }

  /** Return model IDs for a specific provider. */
  getProviderModels(providerId: string): string[] {
    const provider = this._providers.find((p) => p.id === providerId);
    if (!provider) return [];
    return provider.models.map((m) => m.id);
  }

  /** Return status information for each registered provider. */
  async getProviderStatuses(): Promise<
    Array<{ id: string; name: string; type: string; available: boolean }>
  > {
    // Parallel availability checks for better performance
    const results = await Promise.all(
      this._providers.map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        available: await provider.isAvailable(),
      })),
    );

    return results;
  }

  getModelRouterStats(): ModelRouterStatsSnapshot | null {
    return this._modelRouter?.getStatsSnapshot() ?? null;
  }

}
