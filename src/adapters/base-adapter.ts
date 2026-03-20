/**
 * Base adapter for OpenAI-compatible API providers.
 *
 * Provides common implementation for providers that use the OpenAI SDK
 * with a custom base URL (Google, Groq, OpenRouter).
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

import type { LLMProvider, GenerateRequest, GenerateResponse, ModelInfo } from '../core/types.js';
import type { Vault } from '../vault/vault.js';

/**
 * Configuration for OpenAI-compatible API adapters.
 */
export interface OpenAICompatibleConfig {
  /** Provider ID (e.g., 'google', 'groq', 'openrouter') */
  id: string;
  /** Display name */
  name: string;
  /** OpenAI-compatible base URL */
  baseURL: string;
  /** Available models */
  models: ModelInfo[];
  /** Default model ID when none specified */
  defaultModel: string;
  /** Optional HTTP headers (e.g., HTTP-Referer for OpenRouter) */
  defaultHeaders?: Record<string, string>;
}

/**
 * Base class for OpenAI-compatible API providers.
 * Reduces code duplication across Google, Groq, and OpenRouter adapters.
 */
export abstract class BaseOpenAICompatibleAdapter implements LLMProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly baseURL: string;
  abstract readonly models: ModelInfo[];
  abstract readonly defaultModel: string;
  protected readonly defaultHeaders?: Record<string, string>;

  constructor(protected readonly vault: Vault) {}

  readonly type = 'api' as const;

  // Client cache per apiKey to avoid recreating TLS connections
  private clientCache = new Map<string, OpenAI>();

  /**
   * Get or create a cached OpenAI client for the given apiKey.
   * Caching avoids TLS handshake overhead on every request.
   */
  private getClient(apiKey: string): OpenAI {
    if (!this.clientCache.has(apiKey)) {
      this.clientCache.set(apiKey, new OpenAI({
        apiKey,
        baseURL: this.baseURL,
        defaultHeaders: this.defaultHeaders,
      }));
    }
    return this.clientCache.get(apiKey)!;
  }

  /**
   * Generate text using the OpenAI-compatible API.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = this.vault.getDecrypted(this.id, 'default', request.project);
    const client = this.getClient(apiKey);

    const model = request.model ?? this.defaultModel;
    const messages: ChatCompletionMessageParam[] = [];

    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    messages.push({ role: 'user', content: request.prompt });

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? this.models[0]?.maxTokens ?? 4096,
      messages,
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      provider: this.id,
      model,
      tokensUsed: response.usage?.total_tokens ?? undefined,
    };
  }

  /**
   * Check if the provider is available (has credentials in vault).
   */
  async isAvailable(): Promise<boolean> {
    return this.vault.has(this.id);
  }
}
