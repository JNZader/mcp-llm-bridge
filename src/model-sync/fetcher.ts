/**
 * Model Sync Fetchers
 *
 * Provider-specific model fetchers for OpenAI, Anthropic, Gemini, etc.
 */

import {
  ModelInfo,
  ProviderType,
  PROVIDER_TYPE,
  type ModelPricing,
} from './types.js';

// === Abstract Interface ===

export interface ModelFetcher {
  fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]>;
}

// === OpenAI-Style Fetcher (works for OpenAI, Groq, OpenRouter) ===

export class OpenAIModelFetcher implements ModelFetcher {
  async fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        name?: string;
        description?: string;
        context_window?: number;
        pricing?: { input?: number; output?: number };
      }>;
    };

    return data.data.map((m) => {
      const model: ModelInfo = {
        id: m.id,
        name: m.name || m.id,
        description: m.description,
        contextLength: m.context_window,
      };

      if (m.pricing) {
        const pricing: ModelPricing = {
          input: m.pricing.input ?? 0,
          output: m.pricing.output ?? 0,
        };
        model.pricing = pricing;
      }

      return model;
    });
  }
}

// === Anthropic Fetcher ===

export class AnthropicModelFetcher implements ModelFetcher {
  async fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }

    const data = (await response.json()) as {
      models: Array<{
        id: string;
        display_name?: string;
        description?: string;
        context_window?: number;
        pricing?: { input?: number; output?: number };
      }>;
    };

    return data.models.map((m) => {
      const model: ModelInfo = {
        id: m.id,
        name: m.display_name || m.id,
        description: m.description,
        contextLength: m.context_window,
      };

      if (m.pricing) {
        const pricing: ModelPricing = {
          input: m.pricing.input ?? 0,
          output: m.pricing.output ?? 0,
        };
        model.pricing = pricing;
      }

      return model;
    });
  }
}

// === Gemini Fetcher (paginated) ===

export class GeminiModelFetcher implements ModelFetcher {
  async fetchModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(`${baseUrl}/models`);
      url.searchParams.set('key', apiKey);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = (await response.json()) as {
        models: Array<{
          name: string;
          displayName?: string;
          description?: string;
          inputTokenLimit?: number;
          outputTokenLimit?: number;
        }>;
        nextPageToken?: string;
      };

      const pageModels = data.models.map((m) => {
        const contextLength = m.inputTokenLimit
          ? m.inputTokenLimit + (m.outputTokenLimit ?? 0)
          : undefined;

        const model: ModelInfo = {
          id: m.name.replace('models/', ''),
          name: m.displayName || m.name,
          description: m.description,
          contextLength,
        };

        return model;
      });

      models.push(...pageModels);
      pageToken = data.nextPageToken;
    } while (pageToken);

    return models;
  }
}

// === Fetcher Registry ===

export type FetcherClass = new () => ModelFetcher;

export const modelFetchers: Record<ProviderType, FetcherClass> = {
  [PROVIDER_TYPE.OPENAI]: OpenAIModelFetcher,
  [PROVIDER_TYPE.GROQ]: OpenAIModelFetcher,
  [PROVIDER_TYPE.OPENROUTER]: OpenAIModelFetcher,
  [PROVIDER_TYPE.ANTHROPIC]: AnthropicModelFetcher,
  [PROVIDER_TYPE.GEMINI]: GeminiModelFetcher,
};

// === Helper Functions ===

export function getFetcherForProvider(
  provider: ProviderType
): ModelFetcher | null {
  const FetcherClass = modelFetchers[provider];
  if (!FetcherClass) return null;
  return new FetcherClass();
}

export function isSupportedProvider(provider: string): provider is ProviderType {
  return provider in modelFetchers;
}
