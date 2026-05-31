/**
 * Model routing configuration loader.
 *
 * Reads model-routing.json from the project root, validates its structure,
 * and converts it to the internal ModelRoutingConfig type.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import type {
  ModelRoutingConfig,
  ModelEndpoint,
  RouteRule,
  CostTier,
} from './types.js';
import { COST_TIER_ORDER } from './types.js';
import { TASK_TYPE_VALUES, type TaskType } from '../classification/index.js';

/** Raw endpoint definition as it appears in model-routing.json. */
export interface JsonEndpoint {
  id: string;
  providerId: string;
  model: string;
  costTier: CostTier;
  capabilities: string[];
  maxTokens: number;
}

/** Raw routing rule as it appears in model-routing.json. */
export interface JsonRouteRule {
  id: string;
  taskType: TaskType | '*';
  preferredEndpoints: string[];
  maxCostTier: CostTier;
  /** @deprecated Ignored at runtime and accepted only for backward compatibility. */
  minQuality?: string;
  /** @deprecated Ignored at runtime and accepted only for backward compatibility. */
  keywordPatterns?: string[];
  allowFallback: boolean;
}

/** Raw configuration as it appears in model-routing.json. */
export interface JsonModelRoutingConfig {
  enabled: boolean;
  endpoints: JsonEndpoint[];
  rules: JsonRouteRule[];
  defaultEndpoint: string;
  qualityThreshold: number;
  qualityWindowSize: number;
}

/**
 * Validate that a value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate that a value is a valid cost tier.
 */
function isValidCostTier(value: unknown): value is CostTier {
  return isNonEmptyString(value) && COST_TIER_ORDER.includes(value as CostTier);
}

/**
 * Validate that a value is a valid runtime task type or wildcard.
 */
function isValidTaskType(value: unknown): value is TaskType | '*' {
  return value === '*' || (isNonEmptyString(value) && TASK_TYPE_VALUES.includes(value as TaskType));
}

/**
 * Validate a raw endpoint from JSON.
 */
function validateEndpoint(raw: unknown): JsonEndpoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.id)) return null;
  if (!isNonEmptyString(obj.providerId)) return null;
  if (!isNonEmptyString(obj.model)) return null;
  if (!isValidCostTier(obj.costTier)) return null;
  if (!Array.isArray(obj.capabilities)) return null;
  if (typeof obj.maxTokens !== 'number' || obj.maxTokens <= 0) return null;

  return {
    id: obj.id,
    providerId: obj.providerId,
    model: obj.model,
    costTier: obj.costTier,
    capabilities: obj.capabilities.filter((c): c is string => typeof c === 'string'),
    maxTokens: obj.maxTokens,
  };
}

/**
 * Validate a raw routing rule from JSON.
 */
function validateRule(raw: unknown): JsonRouteRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.id)) return null;
  if (!isValidTaskType(obj.taskType)) return null;
  if (!Array.isArray(obj.preferredEndpoints)) return null;
  if (!isValidCostTier(obj.maxCostTier)) return null;
  if (typeof obj.allowFallback !== 'boolean') return null;

  return {
    id: obj.id,
    taskType: obj.taskType,
    preferredEndpoints: obj.preferredEndpoints.filter(
      (e): e is string => typeof e === 'string',
    ),
    maxCostTier: obj.maxCostTier,
    allowFallback: obj.allowFallback,
  };
}

/**
 * Validate the raw JSON configuration object.
 */
function validateConfig(raw: unknown): JsonModelRoutingConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.enabled !== 'boolean') return null;
  if (!Array.isArray(obj.endpoints)) return null;
  if (!Array.isArray(obj.rules)) return null;
  if (!isNonEmptyString(obj.defaultEndpoint)) return null;
  if (typeof obj.qualityThreshold !== 'number') return null;
  if (typeof obj.qualityWindowSize !== 'number') return null;

  const endpoints = obj.endpoints
    .map(validateEndpoint)
    .filter((e): e is JsonEndpoint => e !== null);
  const rules = obj.rules
    .map(validateRule)
    .filter((r): r is JsonRouteRule => r !== null);

  return {
    enabled: obj.enabled,
    endpoints,
    rules,
    defaultEndpoint: obj.defaultEndpoint,
    qualityThreshold: obj.qualityThreshold,
    qualityWindowSize: obj.qualityWindowSize,
  };
}

/**
 * Convert a JSON endpoint to the internal ModelEndpoint type.
 */
function toModelEndpoint(json: JsonEndpoint): ModelEndpoint {
  return {
    id: json.id,
    name: `${json.providerId} / ${json.model}`,
    provider: json.providerId,
    modelId: json.model,
    costTier: json.costTier,
    capabilities: json.capabilities,
    isLocal: json.providerId === 'opencode-cli',
    maxTokens: json.maxTokens,
    available: true,
  };
}

/**
 * Convert a JSON routing rule to the internal RouteRule type.
 */
function toRouteRule(json: JsonRouteRule): RouteRule {
  return {
    id: json.id,
    taskPattern: json.taskType,
    preferredModels: json.preferredEndpoints,
    maxCostTier: json.maxCostTier,
    allowFallback: json.allowFallback,
  };
}

/**
 * Convert the validated JSON config to the internal ModelRoutingConfig type.
 */
function toModelRoutingConfig(json: JsonModelRoutingConfig): ModelRoutingConfig {
  return {
    enabled: json.enabled,
    endpoints: json.endpoints.map(toModelEndpoint),
    rules: json.rules.map(toRouteRule),
    defaultEndpoint: json.defaultEndpoint,
    qualityThreshold: json.qualityThreshold,
    qualityWindowSize: json.qualityWindowSize,
  };
}

/**
 * Load and validate the model-routing.json configuration file.
 *
 * Looks for model-routing.json in the project root (relative to this file's
 * location inside src/model-routing/). Returns null if the file is missing,
 * cannot be read, or fails validation.
 */
export function loadConfig(): ModelRoutingConfig | null {
  // Resolve project root from this file's location (src/model-routing/ → ../..)
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const projectRoot = resolve(__dirname, '..', '..');
  const configPath = resolve(projectRoot, 'model-routing.json');

  if (!existsSync(configPath)) {
    return null;
  }

  let rawJson: unknown;
  try {
    const content = readFileSync(configPath, 'utf-8');
    rawJson = JSON.parse(content);
  } catch {
    return null;
  }

  const validated = validateConfig(rawJson);
  if (!validated) {
    return null;
  }

  return toModelRoutingConfig(validated);
}
