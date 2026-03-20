/**
 * Router — provider selection and fallback logic.
 *
 * Resolves which LLM provider to use based on the request's
 * preferred model/provider, falling back through available
 * candidates in priority order (API first, then CLI).
 */

import type {
  GenerateRequest,
  GenerateResponse,
  LLMProvider,
  ModelInfo,
} from './types.js';
import { logger } from './logger.js';
import { getCircuitBreakerRegistry, CircuitBreakerOpenError } from './circuit-breaker.js';

export class Router {
  private providers: LLMProvider[] = [];

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
        return this.withResolutionMetadata(request, result, false, latencyMs);
      } catch (error) {
        circuitBreaker.recordFailure(provider.id);
        const message = error instanceof Error ? error.message : String(error);
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
        return this.withResolutionMetadata(request, result, index > 0, latencyMs);
      } catch (error) {
        circuitBreaker.recordFailure(provider.id);
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ provider: provider.id, error: message }, 'Provider failed');
        errors.push(`${provider.id}: ${message}`);
        continue;
      }
    }

    throw new Error(
      `All providers failed. Store credentials via vault_store or install a CLI tool.\n${errors.join('\n')}`,
    );
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
