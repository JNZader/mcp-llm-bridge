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
 */

import type {
  GenerateRequest,
  GenerateResponse,
  LLMProvider,
  ModelInfo,
} from './types.js';
import type { InternalLLMRequest, InternalLLMResponse } from './internal-model.js';
import type { TransformerRegistry } from './transformer.js';
import { logger } from './logger.js';
import { getCircuitBreakerRegistry, CircuitBreakerOpenError } from './circuit-breaker.js';

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

  /** Set the transformer registry for the new pipeline. */
  setTransformerRegistry(registry: TransformerRegistry): void {
    this._transformerRegistry = registry;
  }

  /** Get the transformer registry (null if not set). */
  get transformerRegistry(): TransformerRegistry | null {
    return this._transformerRegistry;
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

  /**
   * Generate using the transformer pipeline (InternalLLMRequest → InternalLLMResponse).
   *
   * This is the new pipeline path, used when USE_TRANSFORMERS=true.
   * For each candidate provider:
   * 1. Look up the outbound transformer by provider ID
   * 2. Transform InternalLLMRequest → provider-native format
   * 3. Call the provider adapter (which uses the native format internally)
   * 4. Transform the response → InternalLLMResponse
   *
   * Falls back through candidates on failure, same as generate().
   */
  async generateFromInternal(request: InternalLLMRequest): Promise<InternalLLMResponse> {
    if (!this._transformerRegistry) {
      throw new Error('Transformer registry not configured. Call setTransformerRegistry() first.');
    }

    const registry = this._transformerRegistry;
    const startTime = Date.now();

    // Build a GenerateRequest-compatible object for candidate resolution
    const resolveRequest: GenerateRequest = {
      prompt: '', // not used for resolution, just for type compat
      model: request.model,
      provider: request.metadata?.['provider'] as string | undefined,
    };

    const candidates = await this.resolveCandidates(resolveRequest);

    if (candidates.length === 0) {
      throw new Error(
        'No providers available. Store API credentials via vault_store or install a CLI tool.',
      );
    }

    const circuitBreaker = getCircuitBreakerRegistry();
    const availableCandidates = candidates.filter((p) => circuitBreaker.canRequest(p.id));

    if (availableCandidates.length === 0) {
      const openProviders = candidates.map((p) => p.id).join(', ');
      throw new Error(
        `All providers have circuit breakers open: ${openProviders}. Wait for recovery or check provider status.`,
      );
    }

    const errors: string[] = [];

    for (const provider of availableCandidates) {
      // Look up outbound transformer for this provider
      const outbound = registry.getOutbound(provider.id);

      if (!outbound) {
        // No transformer for this provider — use the generic CLI transformer
        // or skip to next candidate
        const cliOutbound = registry.getOutbound('cli');
        if (provider.type === 'cli' && cliOutbound) {
          // Use CLI transformer for CLI providers without a specific transformer
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

            return cliOutbound.transformResponse(result);
          } catch (error) {
            circuitBreaker.recordFailure(provider.id);
            const message = error instanceof Error ? error.message : String(error);
            logger.warn({ provider: provider.id, error: message }, 'Provider failed (CLI transformer)');
            errors.push(`${provider.id}: ${message}`);
            continue;
          }
        }

        logger.warn({ provider: provider.id }, 'No outbound transformer registered, skipping');
        errors.push(`${provider.id}: no outbound transformer`);
        continue;
      }

      try {
        // Transform internal → provider native format
        const nativeRequest = outbound.transformRequest(request);

        // For API providers, we still call the adapter's generate()
        // The adapter handles the actual HTTP call
        // We construct a GenerateRequest from the internal request
        const adapterRequest: GenerateRequest = {
          prompt: this.extractPromptFromInternal(request),
          system: this.extractSystemFromInternal(request),
          model: request.model,
          maxTokens: request.maxTokens,
          provider: provider.id,
        };

        const result = await provider.generate(adapterRequest);
        circuitBreaker.recordSuccess(provider.id);

        // Transform the adapter result to InternalLLMResponse
        // For now, we wrap the GenerateResponse into something the outbound
        // response transformer can handle
        const latencyMs = Date.now() - startTime;

        return {
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
