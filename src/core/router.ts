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
 * When a GroupStore is configured, the router checks for group-based
 * routing first: if a group matches the requested model (via modelPattern),
 * it uses the group's balancer strategy to order providers. Session
 * stickiness is checked before balancing when enabled.
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
import { classifyForOffload } from '../local-llm/router.js';
import { classify } from '../classification/index.js';
import type { TaskClassification } from '../classification/index.js';
import type { ModelRouterStatsSnapshot, RoutingDecision } from '../model-routing/types.js';
import {
  prioritizeEndpointCandidate,
  reorderByLatency,
  resolveExecutableCandidates,
  resolveCandidates,
} from './router-candidate-planner.js';
import {
  createAttemptTelemetryCallbacks,
  createStreamingRecordResult,
  recordLocalFallbackMetric,
  type RouterTelemetryContext,
} from './router-telemetry.js';
import { executeGenerateAttempt, tryProvider } from './router-executor.js';
import { buildInternalRoutingPlan } from './router-internal-plan.js';
import {
  buildRoutingMetadata,
  buildGenerateRequest,
  buildInternalRequest,
  withResolutionMetadata,
} from './router-shaping.js';
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
  recordResult: (input: {
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs: number;
    success: boolean;
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
   * Precedence stack (highest to lowest):
   * 1. Session stickiness
   * 2. Group-based routing
   * 3. ModelRouter (when enabled)
   * 4. Local-LLM offloading (when enabled)
   * 5. Standard resolution
   * 6. Latency reordering
   *
   * Tries each candidate in resolution order and falls back to the next
   * on failure. Throws if all providers fail.
   * Uses circuit breaker to skip providers that are currently failing.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    const telemetry = createAttemptTelemetryCallbacks(this.getTelemetryContext());
    const attemptedProviders: string[] = [];
    let candidates = await resolveCandidates(
      this._providers,
      request,
      (orderedCandidates) =>
        reorderByLatency(orderedCandidates, this._latencyMeasurer, this._explorationRate),
    );

    if (candidates.length === 0) {
      throw new Error(
        'No providers available. Store API credentials via vault_store or install a CLI tool.',
      );
    }

    // ── Model Routing: classify and route to optimal endpoint ──
    let modelRouterDecision: RoutingDecision | null = null;
    let appliedModelRouterDecision: RoutingDecision | null = null;
    let classification: TaskClassification | null = null;
    let offloadClassification: TaskClassification | null = null;
    if (this._modelRouter && this._modelRouter.enabled && !request.provider && !request.strict) {
      classification = classify(request.prompt);
      modelRouterDecision = this._modelRouter.route(classification);
      if (modelRouterDecision) {
        const routedCandidates = prioritizeEndpointCandidate(
          candidates,
          modelRouterDecision.endpoint,
        );
        if (routedCandidates) {
          candidates = routedCandidates;
          appliedModelRouterDecision = modelRouterDecision;
        } else {
          logger.warn({ endpointId: modelRouterDecision.endpoint.id }, 'Unmatched ModelRouter endpoint');
        }
      }
    }

    // ── Sprint 3: Insert local-llm as first candidate when offloadable ──
    // Only when ModelRouter is disabled or returned null (superseded by ModelRouter)
    if (!request.provider && !request.strict && !modelRouterDecision) {
      offloadClassification = classifyForOffload(request.prompt);
      if (offloadClassification.shouldOffload) {
        const localIndex = candidates.findIndex((p) => p.id === 'local-llm');
        if (localIndex > 0) {
          const localProvider = candidates[localIndex]!;
          candidates = [localProvider, ...candidates.filter((_, i) => i !== localIndex)];
        }
      }
    }

    // Filter out providers with open circuit breakers (V2 with per-model granularity)
    const circuitBreaker = getCircuitBreakerV2();
    const model = modelRouterDecision?.endpoint.modelId ?? request.model ?? 'unknown';
    const { availableCandidates, blockedStrictCandidate } = resolveExecutableCandidates(
      candidates,
      circuitBreaker,
      model,
      request.strict === true,
    );

    if (request.strict && blockedStrictCandidate) {
      throw new Error(
        `Strict mode candidate ${blockedStrictCandidate.id} is blocked by an open circuit breaker.`,
      );
    }

    if (availableCandidates.length === 0) {
      // All candidates have open circuit breakers
      const openProviders = candidates.map((p) => p.id).join(', ');
      throw new Error(
        `All providers have circuit breakers open: ${openProviders}. Wait for recovery or check provider status.`,
      );
    }

    if (request.strict) {
      const provider = availableCandidates[0];

      if (!provider) {
        throw new Error(
          'No providers available. Store API credentials via vault_store or install a CLI tool.',
        );
      }

      attemptedProviders.push(provider.id);
      const result = await executeGenerateAttempt({
        provider,
        request: buildGenerateRequest(
          request,
          provider,
          modelRouterDecision?.endpoint,
        ),
        routedEndpoint: modelRouterDecision?.endpoint,
        circuitBreaker,
        startTime,
        defaultModel: model,
        classification,
        ...telemetry,
        logFailure: ({ provider: failedProvider, attemptedModel, message }) => {
          logger.warn({ provider: failedProvider.id, model: attemptedModel, error: message }, 'Provider failed');
        },
      });
      const latencyMs = Date.now() - startTime;
      return withResolutionMetadata(
        request,
        result,
        false,
        latencyMs,
        buildRoutingMetadata(result, false, {
          strategy: determineRoutingStrategy(request, appliedModelRouterDecision, offloadClassification),
          attemptedProviders,
          classification: classification ?? offloadClassification,
          modelRouterDecision: appliedModelRouterDecision,
          decisionReason: determineDecisionReason(
            request,
            appliedModelRouterDecision,
            offloadClassification,
          ),
        }),
      );
    }

    const providerErrors = createProviderErrorAccumulator();
    const attemptedResult = await tryCandidates(availableCandidates, (provider) => {
      attemptedProviders.push(provider.id);
      return executeGenerateAttempt({
        provider,
        request: buildGenerateRequest(
          request,
          provider,
          modelRouterDecision?.endpoint,
        ),
        routedEndpoint: modelRouterDecision?.endpoint,
        circuitBreaker,
        startTime,
        defaultModel: model,
        classification,
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
      const latencyMs = Date.now() - startTime;
      return withResolutionMetadata(
        request,
        attemptedResult.result,
        attemptedResult.index > 0,
        latencyMs,
        buildRoutingMetadata(attemptedResult.result, attemptedResult.index > 0, {
          strategy: determineRoutingStrategy(request, appliedModelRouterDecision, offloadClassification),
          attemptedProviders,
          classification: classification ?? offloadClassification,
          modelRouterDecision: appliedModelRouterDecision,
          decisionReason: determineDecisionReason(
            request,
            appliedModelRouterDecision,
            offloadClassification,
          ),
        }),
      );
    }

    // Try free model fallback before giving up
    if (this._freeModelRouter?.isAvailable) {
      try {
        logger.info('All paid providers failed, attempting free model fallback');
        const freeResult = await this._freeModelRouter.generate(request);
        attemptedProviders.push('free-models');
        const latencyMs = Date.now() - startTime;
        return withResolutionMetadata(
          request,
          freeResult,
          true,
          latencyMs,
          buildRoutingMetadata(freeResult, true, {
            strategy: determineRoutingStrategy(request, appliedModelRouterDecision, offloadClassification),
            attemptedProviders,
            classification: classification ?? offloadClassification,
            modelRouterDecision: appliedModelRouterDecision,
            decisionReason: 'All paid providers failed; free model fallback succeeded',
          }),
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
   * 5. Standard resolution (model match → fuzzy → provider preference → API before CLI)
   * 6. Latency-based reordering
   *
   * After successful response: pin session if stickiness is enabled.
   */
  async generateFromInternal(request: InternalLLMRequest): Promise<InternalLLMResponse> {
    if (!this._transformerRegistry) {
      throw new Error('Transformer registry not configured. Call setTransformerRegistry() first.');
    }

    const registry = this._transformerRegistry;
    const startTime = Date.now();
    const circuitBreaker = getCircuitBreakerV2();
    const telemetry = createAttemptTelemetryCallbacks(this.getTelemetryContext());

    const plan = await buildInternalRoutingPlan({
      providers: this._providers,
      request,
      groupStore: this._groupStore,
      latencyMeasurer: this._latencyMeasurer,
      explorationRate: this._explorationRate,
      modelRouter: this._modelRouter,
      circuitBreaker,
      optimizeMessages: optimizeMessagesEnabled(),
    });
    const { optimizedRequest } = plan;

    const model = plan.model;
    const clientId = optimizedRequest.metadata?.['clientId'] as string | undefined;

    // 1. Check session stickiness
    if (!plan.requestedProvider && this._sessionManager && clientId && model) {
      const pinned = this._sessionManager.getRouterStickySession(clientId, model);
      if (pinned) {
        const stickyProvider = this._providers.find((p) => p.id === pinned.provider);
        if (stickyProvider) {
          if (circuitBreaker.canExecute(stickyProvider.id, 'default', plan.routedModel).allowed) {
            try {
              const result = await tryProvider({
                provider: stickyProvider,
                request: buildInternalRequest(
                  optimizedRequest,
                  stickyProvider,
                  plan.modelRouterDecision?.endpoint,
                ),
                registry,
                circuitBreaker,
                startTime,
                model: plan.routedModel,
                classification: plan.classification ?? undefined,
                routedEndpoint: plan.modelRouterDecision?.endpoint,
                ...telemetry,
              });
              return result;
            } catch {
              // Sticky provider failed — fall through to normal routing
              logger.warn({ provider: stickyProvider.id, clientId, model }, 'Sticky provider failed, falling through');
            }
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
    const attemptedResult = await tryCandidates(plan.availableCandidates, (provider) =>
      tryProvider({
        provider,
        request: buildInternalRequest(
          optimizedRequest,
          provider,
          plan.modelRouterDecision?.endpoint,
        ),
        registry,
        circuitBreaker,
        startTime,
        classification: plan.classification ?? undefined,
        routedEndpoint: plan.modelRouterDecision?.endpoint,
        ...telemetry,
      }),
      (provider, error) => {
        providerErrors.add(provider, error);
      },
    );

    if (attemptedResult) {
      // Pin session on success if stickiness is enabled
      if (this._sessionManager && clientId && model && plan.matchedGroup?.stickyTTL) {
        this._sessionManager.pinRouterStickySession(
          clientId,
          model,
          attemptedResult.provider.id,
          'default',
          plan.matchedGroup.stickyTTL * 1000,
        );
      }

      return attemptedResult.result;
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
      throw new Error('Transformer registry not configured. Call setTransformerRegistry() first.');
    }

    const registry = this._transformerRegistry;
    const plan = await buildInternalRoutingPlan({
      providers: this._providers,
      request,
      groupStore: this._groupStore,
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

    const resolvedProviders: ResolvedStreamingProvider[] = [];

    for (const provider of plan.availableCandidates) {
      const streamTransformer = registry.getStreamOutbound(provider.id);
      if (streamTransformer) {
        const routedEndpoint = plan.modelRouterDecision?.endpoint;
        resolvedProviders.push({
          provider,
          request: buildInternalRequest(
            plan.optimizedRequest,
            provider,
            routedEndpoint,
            ),
          streamTransformer,
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

function determineRoutingStrategy(
  request: GenerateRequest,
  modelRouterDecision: RoutingDecision | null,
  offloadClassification: TaskClassification | null,
): string {
  if (request.provider) {
    return 'explicit-provider';
  }

  if (modelRouterDecision) {
    return 'model-router';
  }

  if (offloadClassification?.shouldOffload) {
    return 'local-offload';
  }

  if (request.model) {
    return 'requested-model';
  }

  return 'standard';
}

function determineDecisionReason(
  request: GenerateRequest,
  modelRouterDecision: RoutingDecision | null,
  offloadClassification: TaskClassification | null,
): string {
  if (request.provider) {
    return `Provider ${request.provider} requested explicitly`;
  }

  if (modelRouterDecision) {
    return modelRouterDecision.reason;
  }

  if (offloadClassification?.reason) {
    return offloadClassification.reason;
  }

  if (request.model) {
    return `Model ${request.model} requested explicitly`;
  }

  return 'Resolved by standard provider ordering';
}
