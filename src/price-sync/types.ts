/**
 * Price Sync Types
 *
 * TypeScript interfaces for automatic pricing updates from models.dev
 */

// === Currency Constants ===

export const DEFAULT_CURRENCY = 'USD';
export const DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// === Interfaces (Flat Structure) ===

export interface ModelPrice {
  provider: string;
  modelId: string;
  modelName?: string;
  inputPrice: number;   // per 1M tokens
  outputPrice: number; // per 1M tokens
  cacheReadPrice?: number;
  cacheWritePrice?: number;
  currency: string;
}

export interface PriceSyncConfig {
  autoSyncIntervalMs: number; // Default: 24 hours
  defaultCurrency: string;    // Default: 'USD'
}

export interface PriceCalculation {
  inputCost: number;
  outputCost: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  totalCost: number;
  currency: string;
}

// Database record interfaces
export interface StoredPrice {
  id: number;
  provider: string;
  modelId: string;
  modelName: string | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  currency: string;
  source: string | null;
  updatedAt: number;
  isOverridden: boolean;
}

// Type for creating new price entries (without auto-generated id)
export type NewStoredPrice = Omit<StoredPrice, 'id'>;

export interface PriceSyncLogRecord {
  id: number;
  syncedAt: number;
  modelsUpdated: number;
  modelsAdded: number;
  error: string | null;
}

// Sync result
export interface PriceSyncResult {
  updated: number;
  added: number;
  unchanged: number;
  timestamp: number;
  error?: string;
}

// Type guards
export function isModelPrice(value: unknown): value is ModelPrice {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  return (
    typeof obj.provider === 'string' &&
    typeof obj.modelId === 'string' &&
    typeof obj.inputPrice === 'number' &&
    typeof obj.outputPrice === 'number' &&
    typeof obj.currency === 'string'
  );
}

export function isPriceSyncConfig(value: unknown): value is PriceSyncConfig {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  return (
    typeof obj.autoSyncIntervalMs === 'number' &&
    typeof obj.defaultCurrency === 'string'
  );
}

export function isPriceCalculation(value: unknown): value is PriceCalculation {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  return (
    typeof obj.inputCost === 'number' &&
    typeof obj.outputCost === 'number' &&
    typeof obj.totalCost === 'number' &&
    typeof obj.currency === 'string'
  );
}
