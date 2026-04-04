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

  get models(): ModelInfo[] {
    return this.config.models;
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
        `${this.config.name} CLI failed: ${execError.message ?? String(error)}`,
      );
    } finally {
      mount?.cleanup();
    }
  }

  async isAvailable(): Promise<boolean> {
    return isCliAvailableAsync(this.config.cliCommand);
  }
}
