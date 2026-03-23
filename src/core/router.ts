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
import type { GroupStore, ProviderGroup } from './groups.js';
import type { SessionStore } from './session.js';
import type { CostTracker } from './cost-tracker.js';
import { createBalancer, memberKey } from './balancer.js';
import { logger } from './logger.js';
import { getCircuitBreakerRegistry } from './circuit-breaker.js';

/**
 * Check if the transformer pipeline is enabled via env flag.
 * Default: false (backward compat).
 */
export function useTransformers(): boolean {
  return process.env['USE_TRANSFORMERS'] === 'true';
}

export class Router {
  private providers: LLMProvider[] = [];
  private _transformerRegistry: TransformerRegistry | null = null;
  private _groupStore: GroupStore | null = null;
  private _sessionStore: SessionStore | null = null;
  private _costTracker: CostTracker | null = null;

  /** Set the cost tracker for usage recording. */
  setCostTracker(tracker: CostTracker): void {
    this._costTracker = tracker;
  }

  /** Get the cost tracker (null if not set). */
  get costTracker(): CostTracker | null {
    return this._costTracker;
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

  /** Set the session store for stickiness. */
  setSessionStore(store: SessionStore): void {
    this._sessionStore = store;
  }

  /** Get the session store (null if not set). */
  get sessionStore(): SessionStore | null {
    return this._sessionStore;
  }

  private withResolutionMetadata(
    request: GenerateRequest,
    result: GenerateResponse,
    fallbackUsed: boolean,
    latencyMs: number,
  ): GenerateResponse {
    return {
      ...result,
      requestedProvider: request.provider,
      requestedModel: request.model,
      resolvedProvider: result.provider,
      resolvedModel: result.model,
      fallbackUsed,
      latencyMs,
      sessionId: result.sessionId,
    };
  }

  /** Register a provider adapter with the router. */
  register(provider: LLMProvider): void {
    this.providers.push(provider);
  }

  /**
   * Generate text by routing the request to the best available provider.
   *
   * Tries each candidate in resolution order and falls back to the next
   * on failure. Throws if all providers fail.
   * Uses circuit breaker to skip providers that are currently failing.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    const candidates = await this.resolveCandidates(request);

    if (candidates.length === 0) {
      throw new Error(
        'No providers available. Store API credentials via vault_store or install a CLI tool.',
      );
    }

    // Filter out providers with open circuit breakers
    const circuitBreaker = getCircuitBreakerRegistry();
    const availableCandidates = candidates.filter((p) => circuitBreaker.canRequest(p.id));

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

      try {
        const result = await provider.generate(request);
        circuitBreaker.recordSuccess(provider.id);
        const latencyMs = Date.now() - startTime;
        this.recordUsage(provider.id, request.model ?? 'unknown', result.tokensUsed ?? 0, 0, latencyMs, true, request.project);
        return this.withResolutionMetadata(request, result, false, latencyMs);
      } catch (error) {
        circuitBreaker.recordFailure(provider.id);
        const message = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - startTime;
        this.recordUsage(provider.id, request.model ?? 'unknown', 0, 0, latencyMs, false, request.project, message);
        logger.warn({ provider: provider.id, error: message }, 'Provider failed');
        throw error;
      }
    }

    const errors: string[] = [];

    for (const [index, provider] of availableCandidates.entries()) {
      try {
        const result = await provider.generate(request);
        circuitBreaker.recordSuccess(provider.id);
        const latencyMs = Date.now() - startTime;
        this.recordUsage(provider.id, result.model ?? request.model ?? 'unknown', result.tokensUsed ?? 0, 0, latencyMs, true, request.project);
        return this.withResolutionMetadata(request, result, index > 0, latencyMs);
      } catch (error) {
        circuitBreaker.recordFailure(provider.id);
        const message = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - startTime;
        this.recordUsage(provider.id, request.model ?? 'unknown', 0, 0, latencyMs, false, request.project, message);
        logger.warn({ provider: provider.id, error: message }, 'Provider failed');
        errors.push(`${provider.id}: ${message}`);
        continue;
      }
    }

    throw new Error(
      `All providers failed. Store credentials via vault_store or install a CLI tool.\n${errors.join('\n')}`,
    );
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
   * 3. Fallback to current behavior (sequential through all providers)
   *
   * After successful response: pin session if stickiness is enabled.
   */
  async generateFromInternal(request: InternalLLMRequest): Promise<InternalLLMResponse> {
    if (!this._transformerRegistry) {
      throw new Error('Transformer registry not configured. Call setTransformerRegistry() first.');
    }

    const registry = this._transformerRegistry;
    const startTime = Date.now();

    const model = request.model ?? '';
    const clientId = request.metadata?.['clientId'] as string | undefined;

    // 1. Check session stickiness
    if (this._sessionStore && clientId && model) {
      const pinned = this._sessionStore.get(clientId, model);
      if (pinned) {
        const stickyProvider = this.providers.find((p) => p.id === pinned.provider);
        if (stickyProvider) {
          const circuitBreaker = getCircuitBreakerRegistry();
          if (circuitBreaker.canRequest(stickyProvider.id)) {
            try {
              const result = await this.tryProvider(stickyProvider, request, registry, startTime);
              return result;
            } catch {
              // Sticky provider failed — fall through to normal routing
              logger.warn({ provider: stickyProvider.id, clientId, model }, 'Sticky provider failed, falling through');
            }
          }
        }
      }
    }

    // 2. Check group-based routing
    let matchedGroup: ProviderGroup | null = null;
    let orderedCandidates: LLMProvider[] | null = null;

    if (this._groupStore && model) {
      matchedGroup = this._groupStore.findByModel(model);
      if (matchedGroup) {
        orderedCandidates = this.resolveGroupCandidates(matchedGroup);
      }
    }

    // 3. Fallback to standard resolution if no group matched
    if (!orderedCandidates) {
      const resolveRequest: GenerateRequest = {
        prompt: '',
        model: request.model,
        provider: request.metadata?.['provider'] as string | undefined,
      };
      orderedCandidates = await this.resolveCandidates(resolveRequest);
    }

    if (orderedCandidates.length === 0) {
      throw new Error(
        'No providers available. Store API credentials via vault_store or install a CLI tool.',
      );
    }

    const circuitBreaker = getCircuitBreakerRegistry();
    const availableCandidates = orderedCandidates.filter((p) => circuitBreaker.canRequest(p.id));

    if (availableCandidates.length === 0) {
      const openProviders = orderedCandidates.map((p) => p.id).join(', ');
      throw new Error(
        `All providers have circuit breakers open: ${openProviders}. Wait for recovery or check provider status.`,
      );
    }

    const errors: string[] = [];

    for (const provider of availableCandidates) {
      try {
        const result = await this.tryProvider(provider, request, registry, startTime);

        // Pin session on success if stickiness is enabled
        if (this._sessionStore && clientId && model && matchedGroup?.stickyTTL) {
          this._sessionStore.pin(
            clientId,
            model,
            provider.id,
            'default',
            matchedGroup.stickyTTL * 1000, // stickyTTL is in seconds, pin expects ms
          );
        }

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider.id}: ${message}`);
        continue;
      }
    }

    throw new Error(
      `All providers failed. Store credentials via vault_store or install a CLI tool.\n${errors.join('\n')}`,
    );
  }

  /**
   * Try a single provider through the transformer pipeline.
   * Handles both API providers (with outbound transformer) and CLI providers.
   * Records circuit breaker success/failure.
   */
  private async tryProvider(
    provider: LLMProvider,
    request: InternalLLMRequest,
    registry: TransformerRegistry,
    startTime: number,
  ): Promise<InternalLLMResponse> {
    const circuitBreaker = getCircuitBreakerRegistry();
    const outbound = registry.getOutbound(provider.id);

    if (!outbound) {
      // No transformer — try CLI fallback
      const cliOutbound = registry.getOutbound('cli');
      if (provider.type === 'cli' && cliOutbound) {
        try {
          const nativeRequest = cliOutbound.transformRequest(request);
          const prompt = (nativeRequest as Record<string, unknown>)['prompt'] as string;
          const system = (nativeRequest as Record<string, unknown>)['system'] as string | undefined;

          const result = await provider.generate({
            prompt,
            system,
            model: request.model,
            maxTokens: request.maxTokens,
          });

          circuitBreaker.recordSuccess(provider.id);
          const response = cliOutbound.transformResponse(result);
          const latencyMs = Date.now() - startTime;
          this.recordUsage(provider.id, response.model, response.usage.inputTokens, response.usage.outputTokens, latencyMs, true);
          return response;
        } catch (error) {
          circuitBreaker.recordFailure(provider.id);
          const message = error instanceof Error ? error.message : String(error);
          const latencyMs = Date.now() - startTime;
          this.recordUsage(provider.id, request.model ?? 'unknown', 0, 0, latencyMs, false, undefined, message);
          logger.warn({ provider: provider.id, error: message }, 'Provider failed (CLI transformer)');
          throw error;
        }
      }

      logger.warn({ provider: provider.id }, 'No outbound transformer registered, skipping');
      throw new Error(`no outbound transformer for ${provider.id}`);
    }

    try {
      // Transform internal → provider native format (validates compatibility)
      outbound.transformRequest(request);

      const adapterRequest: GenerateRequest = {
        prompt: this.extractPromptFromInternal(request),
        system: this.extractSystemFromInternal(request),
        model: request.model,
        maxTokens: request.maxTokens,
        provider: provider.id,
      };

      const result = await provider.generate(adapterRequest);
      circuitBreaker.recordSuccess(provider.id);

      const latencyMs = Date.now() - startTime;

      const response: InternalLLMResponse = {
        content: result.text,
        model: result.model,
        finishReason: 'stop',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: result.tokensUsed ?? 0,
        },
        metadata: {
          provider: result.provider,
          fallbackUsed: false,
          latencyMs,
          resolvedProvider: result.provider,
          resolvedModel: result.model,
        },
      };

      this.recordUsage(provider.id, result.model, response.usage.inputTokens, response.usage.outputTokens, latencyMs, true);
      return response;
    } catch (error) {
      circuitBreaker.recordFailure(provider.id);
      const message = error instanceof Error ? error.message : String(error);
      const latencyMs = Date.now() - startTime;
      this.recordUsage(provider.id, request.model ?? 'unknown', 0, 0, latencyMs, false, undefined, message);
      logger.warn({ provider: provider.id, error: message }, 'Provider failed');
      throw error;
    }
  }

  /**
   * Resolve candidates from a provider group using its balancer strategy.
   * Returns providers ordered by the balancer, filtered by circuit breakers.
   */
  private resolveGroupCandidates(group: ProviderGroup): LLMProvider[] {
    const balancer = createBalancer(group.strategy);
    const circuitBreaker = getCircuitBreakerRegistry();

    // Build excluded set from circuit breakers
    const excluded = new Set<string>();
    for (const member of group.members) {
      const key = memberKey(member);
      if (!circuitBreaker.canRequest(member.provider)) {
        excluded.add(key);
      }
    }

    // Get ordered list from balancer
    const ordered: LLMProvider[] = [];
    const used = new Set<string>();

    // Keep selecting from balancer until all members are consumed or returned null
    for (let i = 0; i < group.members.length; i++) {
      const member = balancer.next(group.members, excluded);
      if (!member) break;

      const key = memberKey(member);
      if (used.has(key)) continue;
      used.add(key);

      // Find matching registered provider
      const provider = this.providers.find((p) => p.id === member.provider);
      if (provider) {
        ordered.push(provider);
      }

      // Add to excluded so next iteration picks a different member
      excluded.add(key);
    }

    return ordered;
  }

  /**
   * Record usage via the cost tracker (if configured).
   * Non-blocking — failures are logged, not thrown.
   */
  private recordUsage(
    provider: string,
    model: string,
    tokensIn: number,
    tokensOut: number,
    latencyMs: number,
    success: boolean,
    project?: string,
    errorMessage?: string,
  ): void {
    if (!this._costTracker) return;

    try {
      this._costTracker.record({
        provider,
        model,
        tokensIn,
        tokensOut,
        latencyMs,
        success,
        project,
        errorMessage,
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to record usage');
    }
  }

  /**
   * Extract a flat prompt string from InternalLLMRequest messages.
   * Used to bridge to the legacy GenerateRequest format.
   */
  private extractPromptFromInternal(request: InternalLLMRequest): string {
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');
    return nonSystemMessages
      .map((m) => {
        if (typeof m.content === 'string') return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join('\n');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Extract system prompt from InternalLLMRequest messages.
   */
  private extractSystemFromInternal(request: InternalLLMRequest): string | undefined {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    if (systemMessages.length === 0) return undefined;

    return systemMessages
      .map((m) => {
        if (typeof m.content === 'string') return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join('\n');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  /** Return models from all registered providers. */
  async getAvailableModels(): Promise<ModelInfo[]> {
    // Parallel availability checks for better performance
    const results = await Promise.all(
      this.providers.map(async (provider) => ({
        provider,
        available: await provider.isAvailable(),
      })),
    );

    return results
      .filter((r) => r.available)
      .flatMap((r) => r.provider.models);
  }

  /** Return status information for each registered provider. */
  async getProviderStatuses(): Promise<
    Array<{ id: string; name: string; type: string; available: boolean }>
  > {
    // Parallel availability checks for better performance
    const results = await Promise.all(
      this.providers.map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        available: await provider.isAvailable(),
      })),
    );

    return results;
  }

  /**
   * Resolve the ordered list of candidate providers for a request.
   *
   * Resolution order:
   * 1. If `model` specified — provider with that model goes first
   * 2. If `provider` specified — that provider goes first
   * 3. Default: API providers first, then CLI providers
   */
  private async resolveCandidates(
    request: GenerateRequest,
  ): Promise<LLMProvider[]> {
    // Parallel availability check - avoids N sequential isAvailable() calls
    const availabilityResults = await Promise.all(
      this.providers.map(async (provider) => ({
        provider,
        available: await provider.isAvailable(),
      })),
    );
    const available = availabilityResults
      .filter((r) => r.available)
      .map((r) => r.provider);

    // 1. If model specified, find provider that has that model
    if (request.model) {
      const modelProvider = available.find((p) =>
        p.models.some((m) => m.id === request.model),
      );
      if (modelProvider) {
        return [modelProvider, ...available.filter((p) => p !== modelProvider)];
      }
    }

    // 2. If provider specified, put it first
    if (request.provider) {
      const preferred = available.find((p) => p.id === request.provider);
      if (preferred) {
        return [preferred, ...available.filter((p) => p !== preferred)];
      }
    }

    // 3. Default: API providers first, then CLI
    return available.sort((a, b) => {
      if (a.type === 'api' && b.type === 'cli') return -1;
      if (a.type === 'cli' && b.type === 'api') return 1;
      return 0;
    });
  }
}
