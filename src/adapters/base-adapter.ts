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
import { DynamicModelCache, DEFAULT_DISCOVERED_MAX_TOKENS } from './model-cache.js';

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
  /** Optional environment variable to use when no Vault key exists */
  apiKeyEnv?: string;
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
  /** Optional environment variable to use when no Vault key exists. */
  protected readonly apiKeyEnv?: string;
  /** Curated baseline models — discovery via /models adds to these. */
  protected abstract readonly declaredModels: ModelInfo[];
  abstract readonly defaultModel: string;
  protected readonly defaultHeaders?: Record<string, string>;

  constructor(protected readonly vault: Vault) {}

  readonly type = 'api' as const;

  // Client cache per apiKey to avoid recreating TLS connections
  private clientCache = new Map<string, OpenAI>();

  /**
   * Lazily-built model cache (lazy: subclass fields like `declaredModels`
   * initialize after the base constructor).
   */
  private _modelCache?: DynamicModelCache;
  private get modelCache(): DynamicModelCache {
    if (!this._modelCache) {
      this._modelCache = new DynamicModelCache(
        this.declaredModels,
        () => this.discoverModels(),
        this.id,
      );
    }
    return this._modelCache;
  }

  get models(): ModelInfo[] {
    return this.modelCache.get();
  }

  /** Refresh the dynamic model cache (TTL-gated, never throws). */
  async refreshModels(now: number = Date.now()): Promise<void> {
    return this.modelCache.refresh(now);
  }

  /**
   * Discover models from the provider's /models endpoint. Returns null when
   * no credentials are available (keep declared) or nothing is reported.
   * Idempotent and side-effect-free.
   *
   * Uses global-scope credentials — the advertised model list is provider-level,
   * not per-request. A project with narrower per-project credentials may not be
   * able to call every advertised model (known limitation, backlog).
   */
  protected async discoverModels(): Promise<ModelInfo[] | null> {
    let apiKey: string;
    try {
      apiKey = this.getApiKey();
    } catch {
      return null; // no credentials — keep declared baseline
    }
    // Auto-paginate: providers like OpenRouter list hundreds of models across
    // pages; first-page-only would silently truncate the catalog.
    const discovered: ModelInfo[] = [];
    for await (const model of await this.getClient(apiKey).models.list()) {
      discovered.push({
        id: model.id,
        name: model.id,
        provider: this.id,
        maxTokens: DEFAULT_DISCOVERED_MAX_TOKENS,
      });
    }
    return discovered.length > 0 ? discovered : null;
  }

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
   * Resolve a provider API key from Vault first, then the configured env var.
   */
  private getApiKey(project?: string): string {
    try {
      return this.vault.getDecrypted(this.id, 'default', project);
    } catch {
      const envApiKey = this.getEnvApiKey();
      if (envApiKey) {
        return envApiKey;
      }
      throw new Error(
        `No credential found for provider "${this.id}" in Vault or environment.`,
      );
    }
  }

  /**
   * Read a non-empty API key from this adapter's environment variable.
   */
  private getEnvApiKey(): string | null {
    if (!this.apiKeyEnv) {
      return null;
    }

    const apiKey = process.env[this.apiKeyEnv];
    return apiKey && apiKey.trim().length > 0 ? apiKey : null;
  }

  /**
   * Generate text using the OpenAI-compatible API.
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = this.getApiKey(request.project);
    const client = this.getClient(apiKey);

    const model = request.model ?? this.defaultModel;
    const messages: ChatCompletionMessageParam[] = [];

    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    messages.push({ role: 'user', content: request.prompt });

    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? this.models.find((m) => m.id === model)?.maxTokens ?? 4096,
      messages,
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      provider: this.id,
      model,
      tokensUsed: response.usage?.total_tokens ?? undefined,
      resolvedProvider: this.id,
      resolvedModel: model,
      fallbackUsed: false,
    };
  }

  /**
   * Check if the provider is available (has credentials in vault).
   */
  async isAvailable(): Promise<boolean> {
    return this.vault.has(this.id) || this.getEnvApiKey() !== null;
  }
}
