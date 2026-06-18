/**
 * Base CLI adapter with common functionality.
 * 
 * Provides:
 * - Vault integration
 * - Provider home materialization with caching
 * - Common error handling with stdout parsing
 * - Availability checking
 * 
 * Subclasses implement:
 * - Provider ID, name, and model list
 * - CLI command and arguments construction
 * - Response parsing
 */

import type { LLMProvider, GenerateRequest, GenerateResponse, ModelInfo } from '../core/types.js';
import type { Vault } from '../vault/vault.js';
import { materializeProviderHome } from './cli-home.js';
import { execCliSync, isCliAvailableAsync } from './cli-utils.js';
import { sanitizeErrorMessage } from '../security/sanitize.js';
import { logger } from '../core/logger.js';

/** After a discovery error, retry this soon instead of waiting the full TTL. */
const MODEL_DISCOVERY_ERROR_RETRY_MS = 30 * 1000;

/**
 * Interface for CLI adapter configuration.
 */
export interface CliAdapterConfig {
  readonly id: string;
  readonly name: string;
  readonly cliCommand: string;
  readonly defaultModel: string;
  readonly models: ModelInfo[];
  readonly supportsSystemPrompt?: boolean;
}

/**
 * Merge discovered models with the declared fallback, deduping by id.
 * Discovered entries take precedence on collision; declared-only entries
 * are appended so the baseline is never lost.
 */
export function mergeModels(declared: ModelInfo[], discovered: ModelInfo[]): ModelInfo[] {
  const byId = new Map<string, ModelInfo>();
  for (const model of [...discovered, ...declared]) {
    if (!byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }
  return [...byId.values()];
}

/**
 * Base CLI adapter with common functionality.
 */
export abstract class BaseCliAdapter implements LLMProvider {
  abstract readonly config: CliAdapterConfig;
  
  protected readonly vault: Vault;
  
  constructor(vault: Vault) {
    this.vault = vault;
  }

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get type(): 'cli' {
    return 'cli';
  }

  /**
   * Cached model list. Seeded lazily from `config.models` (the declared
   * fallback) and replaced by `refreshModels()` with dynamically discovered
   * models. Null until the first read or refresh.
   */
  private modelCache: ModelInfo[] | null = null;
  private modelsFetchedAt = 0;
  /** TTL for the dynamic model cache. */
  protected readonly modelCacheTtlMs = 5 * 60 * 1000;

  get models(): ModelInfo[] {
    return this.modelCache ?? this.config.models;
  }

  /**
   * Discover models from a dynamic source (config file, CLI, API).
   * Default: no dynamic source — returns null to keep the declared list.
   * Subclasses override to read e.g. a config file.
   *
   * MUST be idempotent and side-effect-free: refreshModels has no
   * single-flight guard, so concurrent callers may invoke this in parallel
   * and last-writer-wins on the cache. Equal inputs must yield equal output.
   */
  protected async discoverModels(): Promise<ModelInfo[] | null> {
    return null;
  }

  /**
   * Refresh the model cache if the TTL has elapsed. Merges dynamically
   * discovered models with the declared fallback (`config.models`), with
   * discovered entries taking precedence on id collision. Failures degrade
   * to the declared list and never throw.
   *
   * `now` is injectable for deterministic testing.
   */
  async refreshModels(now: number = Date.now()): Promise<void> {
    if (this.modelCache && now - this.modelsFetchedAt < this.modelCacheTtlMs) {
      return;
    }
    try {
      const discovered = await this.discoverModels();
      // null = "no dynamic source / nothing discovered" — a stable answer, so
      // it gets the full TTL like a success. Only a thrown error retries sooner.
      this.modelCache = discovered
        ? mergeModels(this.config.models, discovered)
        : this.config.models;
      this.modelsFetchedAt = now;
    } catch (error) {
      logger.warn(
        { provider: this.config.id, err: error },
        'discoverModels threw; serving declared model fallback',
      );
      this.modelCache = this.modelCache ?? this.config.models;
      // Back-date so the next call retries after the short error window
      // instead of suppressing discovery for a full TTL.
      this.modelsFetchedAt = now - this.modelCacheTtlMs + MODEL_DISCOVERY_ERROR_RETRY_MS;
    }
  }

  /**
   * Build CLI arguments for the generate request.
   */
  protected abstract buildArgs(model: string, prompt: string, system?: string): string[];

  /**
   * Parse CLI response into GenerateResponse.
   */
  protected abstract parseResponse(output: string): string;

  /**
   * Check if provider files are valid for this provider.
   * Override to add validation.
   */
  protected validateProviderFiles(_files: Array<{ fileName: string }>): void {
    // Default: no validation
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const model = request.model ?? this.config.defaultModel;
    const providerFiles = this.vault.getProviderFiles(this.config.cliCommand, request.project);
    
    // Validate provider files if any exist
    if (providerFiles.length > 0) {
      this.validateProviderFiles(providerFiles);
    }

    const mount = providerFiles.length > 0
      ? materializeProviderHome(this.config.cliCommand, providerFiles, request.project)
      : null;

    try {
      const env: Record<string, string> = { ...process.env as Record<string, string> };

      if (mount) {
        env['HOME'] = mount.homeDir;
      }

      const prompt = request.system && this.config.supportsSystemPrompt
        ? request.prompt
        : request.system
          ? `${request.system}\n\n${request.prompt}`
          : request.prompt;

      const args = this.buildArgs(model, prompt, request.system);
      const output = execCliSync(this.config.cliCommand, args, { env });

      const text = this.parseResponse(output);
      return {
        text,
        provider: this.id,
        model,
        tokensUsed: 0,
        resolvedProvider: this.id,
        resolvedModel: model,
        fallbackUsed: false,
      };
    } catch (error) {
      const execError = error as { stdout?: string; message?: string };
      if (execError.stdout) {
        try {
          const text = this.parseResponse(execError.stdout);
          if (text) {
            return { text, provider: this.id, model, tokensUsed: 0, resolvedProvider: this.id, resolvedModel: model, fallbackUsed: false };
          }
        } catch { /* ignore parse errors */ }
      }
      throw new Error(
        sanitizeErrorMessage(`${this.config.name} CLI failed: ${execError.message ?? String(error)}`),
      );
    } finally {
      mount?.cleanup();
    }
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailableAsync(this.config.cliCommand);
  }
}
