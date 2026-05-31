/**
 * Price Sync Fetcher
 *
 * Fetches model pricing from models.dev API
 */

import { ModelPrice, DEFAULT_CURRENCY } from './types.js';

const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;

// === Models.dev Response Types ===

interface ModelsDevPricing {
  name?: string;
  input?: { price?: number; currency?: string };
  output?: { price?: number; currency?: string };
  cache?: { read?: number; write?: number };
}

interface ModelsDevProvider {
  [modelId: string]: ModelsDevPricing;
}

interface ModelsDevResponse {
  providers: {
    [provider: string]: ModelsDevProvider;
  };
}

// === Fetcher ===

export class PriceFetcher {
  private readonly modelsDevUrl = 'https://models.dev/api.json';

  async fetchPrices(timeoutMs: number = DEFAULT_UPSTREAM_TIMEOUT_MS): Promise<ModelPrice[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.modelsDevUrl, { signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Upstream price fetch timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch prices: ${response.status}`);
    }

    const data = (await response.json()) as ModelsDevResponse;

    // Transform models.dev format to internal format
    const prices: ModelPrice[] = [];

    for (const [provider, models] of Object.entries(data.providers)) {
      for (const [modelId, pricing] of Object.entries(models)) {
        prices.push({
          provider: this.normalizeProvider(provider),
          modelId,
          modelName: pricing.name,
          inputPrice: pricing.input?.price ?? 0,
          outputPrice: pricing.output?.price ?? 0,
          cacheReadPrice: pricing.cache?.read,
          cacheWritePrice: pricing.cache?.write,
          currency: pricing.input?.currency ?? DEFAULT_CURRENCY,
        });
      }
    }

    return prices;
  }

  private normalizeProvider(provider: string): string {
    // Normalize provider names (e.g., 'openai' -> 'openai', 'anthropic' -> 'anthropic')
    const mappings: Record<string, string> = {
      openai: 'openai',
      anthropic: 'anthropic',
      google: 'gemini',
      deepseek: 'deepseek',
      groq: 'groq',
    };
    return mappings[provider.toLowerCase()] ?? provider.toLowerCase();
  }
}

// === Helper Functions ===

export function createPriceFetcher(): PriceFetcher {
  return new PriceFetcher();
}
