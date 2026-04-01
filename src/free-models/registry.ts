/**
 * Free Model Registry — manages known free model endpoints.
 *
 * Provides a curated list of free-tier LLM endpoints (NVIDIA NIM,
 * OpenRouter free tier, etc.) and supports user-defined additions
 * via JSON config at ~/.llm-gateway/free-models.json.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../core/logger.js';
import type { FreeModelEntry, ModelCapability } from './types.js';

/** Default config path for user-defined free model entries. */
export const FREE_MODELS_CONFIG_PATH = join(homedir(), '.llm-gateway', 'free-models.json');

/**
 * Built-in free model endpoints.
 *
 * These are well-known free-tier endpoints that require no API key
 * or only a free registration key.
 */
export const BUILTIN_FREE_MODELS: FreeModelEntry[] = [
  {
    id: 'openrouter-free-llama-3.1-8b',
    name: 'Llama 3.1 8B (OpenRouter Free)',
    source: 'openrouter-free',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'meta-llama/llama-3.1-8b-instruct:free',
    capabilities: ['chat', 'code'],
    maxTokens: 8192,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    enabled: true,
  },
  {
    id: 'openrouter-free-gemma-2-9b',
    name: 'Gemma 2 9B (OpenRouter Free)',
    source: 'openrouter-free',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'google/gemma-2-9b-it:free',
    capabilities: ['chat', 'code'],
    maxTokens: 8192,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    enabled: true,
  },
  {
    id: 'openrouter-free-qwen-2.5-7b',
    name: 'Qwen 2.5 7B (OpenRouter Free)',
    source: 'openrouter-free',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'qwen/qwen-2.5-7b-instruct:free',
    capabilities: ['chat', 'code', 'reasoning'],
    maxTokens: 8192,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    enabled: true,
  },
  {
    id: 'nvidia-nim-llama-3.1-8b',
    name: 'Llama 3.1 8B (NVIDIA NIM)',
    source: 'nvidia-nim',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    modelId: 'meta/llama-3.1-8b-instruct',
    capabilities: ['chat', 'code'],
    maxTokens: 8192,
    apiKeyEnv: 'NVIDIA_API_KEY',
    enabled: true,
  },
  {
    id: 'huggingface-zephyr-7b',
    name: 'Zephyr 7B (HuggingFace)',
    source: 'huggingface',
    baseUrl: 'https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta/v1',
    modelId: 'HuggingFaceH4/zephyr-7b-beta',
    capabilities: ['chat'],
    maxTokens: 4096,
    apiKeyEnv: 'HF_API_KEY',
    enabled: true,
  },
];

/**
 * Validate a user-provided free model entry.
 * Returns an array of validation errors (empty = valid).
 */
export function validateEntry(entry: unknown): string[] {
  const errors: string[] = [];
  if (typeof entry !== 'object' || entry === null) {
    return ['Entry must be an object'];
  }

  const e = entry as Record<string, unknown>;

  if (typeof e['id'] !== 'string' || e['id'] === '') errors.push('id must be a non-empty string');
  if (typeof e['name'] !== 'string' || e['name'] === '') errors.push('name must be a non-empty string');
  if (typeof e['source'] !== 'string') errors.push('source must be a string');
  if (typeof e['baseUrl'] !== 'string' || !e['baseUrl']) errors.push('baseUrl must be a non-empty string');
  if (typeof e['modelId'] !== 'string' || !e['modelId']) errors.push('modelId must be a non-empty string');
  if (!Array.isArray(e['capabilities'])) errors.push('capabilities must be an array');
  if (typeof e['maxTokens'] !== 'number' || e['maxTokens'] <= 0) errors.push('maxTokens must be a positive number');

  return errors;
}

/**
 * Load user-defined free model entries from JSON config.
 *
 * File format: { "models": [ ...FreeModelEntry[] ] }
 * Returns empty array if file doesn't exist or is invalid.
 */
export function loadUserModels(configPath?: string): FreeModelEntry[] {
  const path = configPath ?? FREE_MODELS_CONFIG_PATH;

  if (!existsSync(path)) {
    return [];
  }

  try {
    const content = readFileSync(path, 'utf8');
    const parsed = JSON.parse(content) as { models?: unknown[] };

    if (!parsed.models || !Array.isArray(parsed.models)) {
      logger.warn({ path }, 'free-models.json missing "models" array');
      return [];
    }

    const valid: FreeModelEntry[] = [];

    for (const raw of parsed.models) {
      const errors = validateEntry(raw);
      if (errors.length > 0) {
        logger.warn({ errors, entry: raw }, 'Skipping invalid free model entry');
        continue;
      }

      const entry = raw as FreeModelEntry;
      // Default enabled to true if not specified
      if (typeof entry.enabled !== 'boolean') {
        entry.enabled = true;
      }
      valid.push(entry);
    }

    logger.info({ count: valid.length, path }, 'Loaded user-defined free models');
    return valid;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message, path }, 'Failed to load free-models.json');
    return [];
  }
}

/**
 * Free Model Registry.
 *
 * Manages the merged list of built-in and user-defined free model
 * endpoints. User entries with the same ID override built-in entries.
 */
export class FreeModelRegistry {
  private models: Map<string, FreeModelEntry>;

  /**
   * @param userModels  User-defined model entries
   * @param skipBuiltins When true, do NOT load built-in models (use only userModels)
   */
  constructor(userModels: FreeModelEntry[] = [], skipBuiltins: boolean = false) {
    this.models = new Map();

    // Load built-ins first (unless explicitly skipped)
    if (!skipBuiltins) {
      for (const model of BUILTIN_FREE_MODELS) {
        this.models.set(model.id, model);
      }
    }

    // User entries override built-ins by ID (or are the only entries if skipBuiltins)
    for (const model of userModels) {
      this.models.set(model.id, model);
    }
  }

  /** Get all enabled models. */
  getEnabled(): FreeModelEntry[] {
    return [...this.models.values()].filter((m) => m.enabled);
  }

  /** Get all models (including disabled). */
  getAll(): FreeModelEntry[] {
    return [...this.models.values()];
  }

  /** Get a model by ID. */
  get(id: string): FreeModelEntry | undefined {
    return this.models.get(id);
  }

  /** Filter models by capability. */
  getByCapability(capability: ModelCapability): FreeModelEntry[] {
    return this.getEnabled().filter((m) => m.capabilities.includes(capability));
  }

  /** Total count of registered models. */
  get size(): number {
    return this.models.size;
  }
}
