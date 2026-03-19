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

export class Router {
  private providers: LLMProvider[] = [];

  /** Register a provider adapter with the router. */
  register(provider: LLMProvider): void {
    this.providers.push(provider);
  }

  /**
   * Generate text by routing the request to the best available provider.
   *
   * Tries each candidate in resolution order and falls back to the next
   * on failure. Throws if all providers fail.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const candidates = await this.resolveCandidates(request);

    if (candidates.length === 0) {
      throw new Error(
        'No providers available. Store API credentials via vault_store or install a CLI tool.',
      );
    }

    const errors: string[] = [];

    for (const provider of candidates) {
      try {
        return await provider.generate(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[gateway] ${provider.id} failed: ${message}`);
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
    const models: ModelInfo[] = [];
    for (const provider of this.providers) {
      if (await provider.isAvailable()) {
        models.push(...provider.models);
      }
    }
    return models;
  }

  /** Return status information for each registered provider. */
  async getProviderStatuses(): Promise<
    Array<{ id: string; name: string; type: string; available: boolean }>
  > {
    const statuses = [];
    for (const provider of this.providers) {
      statuses.push({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        available: await provider.isAvailable(),
      });
    }
    return statuses;
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
    const available: LLMProvider[] = [];
    for (const p of this.providers) {
      if (await p.isAvailable()) {
        available.push(p);
      }
    }

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
