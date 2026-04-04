/**
 * Free Model Registry — manages known free model endpoints.
 *
 * Provides a curated list of free-tier LLM endpoints (NVIDIA NIM,
 * OpenRouter free tier, etc.) and supports user-defined additions
 * via JSON config at ~/.llm-gateway/free-models.json.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { logger } from '../core/logger.js';
import type { FreeModelEntry, ModelCapability, ModelCatalog, CatalogProvider, ExternalModelDef } from './types.js';
import type { HealthChecker } from './health.js';

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

  /**
   * Bulk-import models into the registry.
   * New entries are added; existing IDs are updated (overwritten).
   */
  importModels(entries: FreeModelEntry[]): number {
    let count = 0;
    for (const entry of entries) {
      this.models.set(entry.id, entry);
      count++;
    }
    return count;
  }

  /** Clear all models from the registry. */
  clear(): void {
    this.models.clear();
  }
}

// ── Catalog Import ──────────────────────────────────────────

/**
 * Parse a context window string (e.g., "128k", "1M", "10M") into a token count.
 */
export function parseContextWindow(ctx: string): number {
  const normalized = ctx.trim().toLowerCase();
  const match = normalized.match(/^([\d.]+)\s*([km]?)$/);
  if (!match) return 8192; // safe fallback

  const value = parseFloat(match[1]!);
  const unit = match[2];

  if (unit === 'm') return Math.round(value * 1_000_000);
  if (unit === 'k') return Math.round(value * 1_000);
  return Math.round(value);
}

/**
 * Map a tier string to a base stability score.
 * Higher-tier models get a higher base score, reflecting their
 * SWE-bench performance and general reliability expectations.
 */
export function tierToBaseStability(tier: string): number {
  const map: Record<string, number> = {
    'S+': 90,
    'S': 80,
    'A+': 70,
    'A': 60,
    'A-': 55,
    'B+': 45,
    'B': 35,
    'C': 20,
  };
  return map[tier] ?? 50;
}

/**
 * Compute stability score for a catalog model.
 *
 * Combines the tier-based base score with optional health check
 * history. If a HealthChecker is provided, reliability data (0-1)
 * is blended in at 40% weight.
 *
 * @param tier      Performance tier from catalog
 * @param sweScore  SWE-bench verified percentage (0-100)
 * @param modelId   ID for health checker lookup
 * @param healthChecker Optional health checker for reliability data
 */
export function computeStabilityScore(
  tier: string,
  sweScore: number,
  modelId?: string,
  healthChecker?: HealthChecker,
): number {
  const baseScore = tierToBaseStability(tier);

  // Blend SWE score (normalized) at 20% weight with tier base at 80%
  const sweNormalized = Math.max(0, Math.min(100, sweScore));
  let score = baseScore * 0.6 + sweNormalized * 0.4;

  // If health data exists, factor in reliability
  if (healthChecker && modelId) {
    const reliability = healthChecker.getReliability(modelId);
    // Only adjust if we have actual data (not the default 0.5)
    if (reliability !== 0.5) {
      const reliabilityScore = reliability * 100;
      score = score * 0.6 + reliabilityScore * 0.4;
    }
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Infer capabilities from a model's tier, display name, and model ID.
 */
function inferCapabilities(model: ExternalModelDef): ModelCapability[] {
  const capabilities: ModelCapability[] = ['chat'];

  const nameLower = (model.displayName + ' ' + model.modelId).toLowerCase();

  // Most coding-tier models support code generation
  if (
    nameLower.includes('coder') ||
    nameLower.includes('codestral') ||
    nameLower.includes('code') ||
    model.sweScore >= 30
  ) {
    capabilities.push('code');
  }

  // Reasoning models
  if (
    nameLower.includes('reasoning') ||
    nameLower.includes('thinking') ||
    nameLower.includes('r1') ||
    nameLower.includes('qwq')
  ) {
    capabilities.push('reasoning');
  }

  return capabilities;
}

/**
 * Generate a unique ID for a catalog model entry.
 */
function catalogEntryId(sourceKey: string, modelId: string): string {
  // Clean the model ID to produce a readable slug
  const slug = modelId
    .replace(/[:@/]/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `catalog-${sourceKey}-${slug}`;
}

/**
 * Convert a catalog provider's models into FreeModelEntry[].
 *
 * @param provider  Catalog provider definition
 * @param healthChecker Optional health checker for stability scoring
 */
export function importProviderModels(
  provider: CatalogProvider,
  healthChecker?: HealthChecker,
): FreeModelEntry[] {
  const entries: FreeModelEntry[] = [];
  const now = new Date().toISOString();

  for (const model of provider.models) {
    const id = catalogEntryId(provider.sourceKey, model.modelId);
    const stabilityScore = computeStabilityScore(
      model.tier,
      model.sweScore,
      id,
      healthChecker,
    );

    entries.push({
      id,
      name: `${model.displayName} (${provider.sourceKey})`,
      source: provider.sourceKey,
      baseUrl: provider.baseUrl,
      modelId: model.modelId,
      capabilities: inferCapabilities(model),
      maxTokens: parseContextWindow(model.contextWindow),
      apiKeyEnv: provider.envKey,
      enabled: true,
      stabilityScore,
      lastStabilityCheck: now,
    });
  }

  return entries;
}

/**
 * Import an entire catalog into FreeModelEntry[].
 *
 * Parses the catalog.json structure and converts all providers'
 * models into FreeModelEntry[] with stability scoring.
 *
 * @param catalog        Parsed ModelCatalog object
 * @param healthChecker  Optional health checker for reliability blending
 * @returns All imported model entries
 */
export function importCatalog(
  catalog: ModelCatalog,
  healthChecker?: HealthChecker,
): FreeModelEntry[] {
  const allEntries: FreeModelEntry[] = [];

  for (const provider of catalog.providers) {
    const entries = importProviderModels(provider, healthChecker);
    allEntries.push(...entries);
  }

  logger.info(
    { modelCount: allEntries.length, providers: catalog.providers.length, version: catalog.version },
    'Imported free model catalog',
  );

  return allEntries;
}

/**
 * Load and parse the bundled catalog.json file.
 *
 * @param catalogPath Override path for testing
 * @returns Parsed ModelCatalog or null if not found/invalid
 */
export function loadCatalog(catalogPath?: string): ModelCatalog | null {
  const defaultPath = join(dirname(fileURLToPath(import.meta.url)), 'catalog.json');
  const path = catalogPath ?? defaultPath;

  if (!existsSync(path)) {
    logger.warn({ path }, 'Catalog file not found');
    return null;
  }

  try {
    const content = readFileSync(path, 'utf8');
    const parsed = JSON.parse(content) as ModelCatalog;

    if (!parsed.providers || !Array.isArray(parsed.providers)) {
      logger.warn({ path }, 'Invalid catalog: missing providers array');
      return null;
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message, path }, 'Failed to load catalog');
    return null;
  }
}
