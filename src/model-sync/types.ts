/**
 * Model Sync Types
 *
 * TypeScript interfaces for Auto Model Sync feature.
 */

// === Const Types Pattern (REQUIRED by TypeScript skill) ===

export const PROVIDER_TYPE = {
  OPENAI: 'openai',
  GROQ: 'groq',
  OPENROUTER: 'openrouter',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
} as const;

export type ProviderType = (typeof PROVIDER_TYPE)[keyof typeof PROVIDER_TYPE];

// === Interfaces (Flat Structure - no inline nesting) ===

export interface ModelPricing {
  input: number;
  output: number;
}

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  contextLength?: number;
  pricing?: ModelPricing;
}

export interface ModelSyncConfig {
  provider: ProviderType;
  baseUrl: string;
  apiKey: string;
  matchRegex?: string;
  autoSyncIntervalMs: number;
}

export interface ModelSyncResult {
  provider: ProviderType;
  timestamp: number;
  modelsFound: ModelInfo[];
  modelsAdded: ModelInfo[];
  modelsRemoved: string[];
  error?: string;
}

// Database record interfaces
export interface ProviderModelRecord {
  id: number;
  provider: ProviderType;
  modelId: string;
  modelName: string | null;
  modelDescription: string | null;
  contextLength: number | null;
  pricingInput: number | null;
  pricingOutput: number | null;
  discoveredAt: number;
  lastSyncedAt: number;
  isActive: boolean;
  matchRegex: string | null;
}

export interface ModelSyncLogRecord {
  id: number;
  provider: ProviderType;
  syncedAt: number;
  modelsFound: number;
  modelsAdded: number;
  modelsRemoved: number;
  error: string | null;
}

// Type guards
export function isProviderType(value: unknown): value is ProviderType {
  return (
    typeof value === 'string' &&
    Object.values(PROVIDER_TYPE).includes(value as ProviderType)
  );
}

export function isModelInfo(value: unknown): value is ModelInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as Record<string, unknown>).id === 'string'
  );
}

export function isModelSyncConfig(value: unknown): value is ModelSyncConfig {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;

  return (
    'provider' in obj &&
    isProviderType(obj.provider) &&
    'baseUrl' in obj &&
    typeof obj.baseUrl === 'string' &&
    'apiKey' in obj &&
    typeof obj.apiKey === 'string' &&
    'autoSyncIntervalMs' in obj &&
    typeof obj.autoSyncIntervalMs === 'number'
  );
}
