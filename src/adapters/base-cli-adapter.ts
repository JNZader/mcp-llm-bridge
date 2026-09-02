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
import {
  assertPromptNotOnArgv,
  execCliSync,
  isCliAvailableAsync,
  MAX_ARGV_PROMPT_CHARS,
} from './cli-utils.js';
import { sanitizeErrorMessage } from '../security/sanitize.js';
import { DynamicModelCache } from './model-cache.js';
import { resolveCliGenerateTimeoutMs } from '../core/constants.js';

/**
 * Interface for CLI adapter configuration.
 */
export interface CliAdapterConfig {
  readonly id: string;
  readonly name: string;
  readonly cliCommand: string;
  readonly defaultModel: string;
  readonly models: ModelInfo[];
  /** If set, the prompt is passed as this flag's value (agy `-p` requires an argument). */
  readonly argvPromptFlag?: string;
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
   * Lazily-built model cache. Lazy because `this.config` is a subclass field
   * initializer that runs AFTER the base constructor — so it isn't available
   * at construction time, only by the time `models`/`refreshModels` are called.
   */
  private _modelCache?: DynamicModelCache;
  private get modelCache(): DynamicModelCache {
    if (!this._modelCache) {
      this._modelCache = new DynamicModelCache(
        this.config.models,
        () => this.discoverModels(),
        this.config.id,
      );
    }
    return this._modelCache;
  }

  get models(): ModelInfo[] {
    return this.modelCache.get();
  }

  /**
   * Discover models from a dynamic source (config file, CLI, API).
   * Default: no dynamic source — returns null to keep the declared list.
   * Subclasses override to read e.g. a config file.
   *
   * MUST be idempotent and side-effect-free: the cache has no single-flight
   * guard, so concurrent callers may invoke this in parallel and last-writer
   * wins. Equal inputs must yield equal output.
   */
  protected async discoverModels(): Promise<ModelInfo[] | null> {
    return null;
  }

  /** Refresh the dynamic model cache (TTL-gated, never throws). */
  async refreshModels(now: number = Date.now()): Promise<void> {
    return this.modelCache.refresh(now);
  }

  /**
   * Build CLI arguments for the generate request.
   *
   * The prompt (and system text) MUST NOT appear here. They are delivered
   * on stdin by `generate()`, or appended via `argvPromptFlag` after a size
   * check. `-p` as a boolean print flag is allowed; `-p <prompt>` is not.
   */
  protected abstract buildArgs(model: string): string[];

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

      const prompt = request.system
        ? `${request.system}\n\n${request.prompt}`
        : request.prompt;

      const args = this.buildArgs(model);
      assertPromptNotOnArgv(this.config.cliCommand, args, [prompt, request.system, request.prompt]);
      const promptFlag = this.config.argvPromptFlag;
      let output: string;
      if (promptFlag) {
        if (prompt.length > MAX_ARGV_PROMPT_CHARS) {
          throw new Error(
            `${this.config.name} CLI refuses prompts over ${MAX_ARGV_PROMPT_CHARS} characters on argv; use a stdin-capable provider such as opencode-cli`,
          );
        }
        args.push(promptFlag, prompt);
        output = execCliSync(this.config.cliCommand, args, {
          env,
          timeout: resolveCliGenerateTimeoutMs(env),
        });
      } else {
        output = execCliSync(this.config.cliCommand, args, {
          env,
          input: prompt,
          timeout: resolveCliGenerateTimeoutMs(env),
        });
      }

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
        } catch (parseError) {
          // A structured error envelope detected in stdout (e.g. Claude's
          // `error_max_turns`) is a better diagnostic than the opaque exit
          // code — surface it. Malformed-JSON SyntaxErrors stay ignored and
          // fall through to the generic exec error below.
          if (parseError instanceof Error && !(parseError instanceof SyntaxError)) {
            throw new Error(
              sanitizeErrorMessage(`${this.config.name} CLI failed: ${parseError.message}`),
            );
          }
        }
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
