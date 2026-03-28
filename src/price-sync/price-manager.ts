/**
 * Price Manager
 *
 * Orchestrates price synchronization with auto-sync capability
 * and manual override support.
 */

import {
  ModelPrice,
  PriceSyncConfig,
  PriceCalculation,
  StoredPrice,
  NewStoredPrice,
  PriceSyncLogRecord,
  PriceSyncResult,
  DEFAULT_CURRENCY,
  DEFAULT_SYNC_INTERVAL_MS,
} from './types.js';
import { createPriceFetcher } from './fetcher.js';

// === Database Interface (minimal, to be implemented by consumer) ===

export interface Database {
  prepare(sql: string): Statement;
}

export interface Statement {
  run(...params: unknown[]): { lastInsertRowid: number };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown | undefined;
}

// === Price Manager ===

export class PriceManager {
  private db: Database;
  private prices: Map<string, ModelPrice>; // Cache: "provider:modelId"
  private syncTimer?: NodeJS.Timeout;
  private config: PriceSyncConfig;

  constructor(db: Database, config?: Partial<PriceSyncConfig>) {
    this.db = db;
    this.prices = new Map();
    this.config = {
      autoSyncIntervalMs: config?.autoSyncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
      defaultCurrency: config?.defaultCurrency ?? DEFAULT_CURRENCY,
    };
    this.refreshCache();
  }

  /**
   * Sync prices from models.dev
   */
  async syncFromUpstream(): Promise<PriceSyncResult> {
    const fetcher = createPriceFetcher();
    const upstreamPrices = await fetcher.fetchPrices();

    let updated = 0;
    let added = 0;
    let unchanged = 0;

    for (const price of upstreamPrices) {
      const existing = this.getStoredPrice(price.provider, price.modelId);

      if (!existing) {
        // New price
        this.storePrice({
          provider: price.provider,
          modelId: price.modelId,
          modelName: price.modelName ?? null,
          inputPrice: price.inputPrice,
          outputPrice: price.outputPrice,
          cacheReadPrice: price.cacheReadPrice ?? null,
          cacheWritePrice: price.cacheWritePrice ?? null,
          currency: price.currency,
          source: 'models.dev',
          updatedAt: Date.now(),
          isOverridden: false,
        });
        added++;
      } else if (!existing.isOverridden) {
        // Update only if not manually overridden
        if (this.hasPriceChanged(existing, price)) {
          this.updatePrice(price.provider, price.modelId, {
            ...price,
            source: 'models.dev',
            updatedAt: Date.now(),
          });
          updated++;
        } else {
          unchanged++;
        }
      } else {
        unchanged++; // User override, skip
      }
    }

    // Refresh cache
    this.refreshCache();

    // Log sync
    const result: PriceSyncResult = {
      updated,
      added,
      unchanged,
      timestamp: Date.now(),
    };
    this.logSync(result);

    return result;
  }

  /**
   * Get price for model (from cache or DB)
   */
  getPrice(provider: string, modelId: string): ModelPrice | null {
    const key = this.buildKey(provider, modelId);

    // Try cache first
    const cached = this.prices.get(key);
    if (cached) {
      return cached;
    }

    // Fall back to database
    const stored = this.getStoredPrice(provider, modelId);
    if (!stored) {
      return null;
    }

    const price: ModelPrice = {
      provider: stored.provider,
      modelId: stored.modelId,
      modelName: stored.modelName ?? undefined,
      inputPrice: stored.inputPrice ?? 0,
      outputPrice: stored.outputPrice ?? 0,
      cacheReadPrice: stored.cacheReadPrice ?? undefined,
      cacheWritePrice: stored.cacheWritePrice ?? undefined,
      currency: stored.currency,
    };

    // Update cache
    this.prices.set(key, price);
    return price;
  }

  /**
   * Calculate cost for a request
   */
  calculateCost(
    provider: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    cacheTokens?: { read?: number; write?: number }
  ): PriceCalculation {
    const price = this.getPrice(provider, modelId);
    if (!price) {
      return {
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        currency: this.config.defaultCurrency,
      };
    }

    const inputCost = (inputTokens / 1_000_000) * price.inputPrice;
    const outputCost = (outputTokens / 1_000_000) * price.outputPrice;

    let cacheReadCost: number | undefined;
    let cacheWriteCost: number | undefined;

    if (cacheTokens?.read && price.cacheReadPrice !== undefined) {
      cacheReadCost = (cacheTokens.read / 1_000_000) * price.cacheReadPrice;
    }

    if (cacheTokens?.write && price.cacheWritePrice !== undefined) {
      cacheWriteCost = (cacheTokens.write / 1_000_000) * price.cacheWritePrice;
    }

    const totalCost =
      inputCost +
      outputCost +
      (cacheReadCost ?? 0) +
      (cacheWriteCost ?? 0);

    return {
      inputCost,
      outputCost,
      cacheReadCost,
      cacheWriteCost,
      totalCost,
      currency: price.currency,
    };
  }

  /**
   * Set manual price override
   */
  setPriceOverride(
    provider: string,
    modelId: string,
    price: Partial<ModelPrice>
  ): void {
    const existing = this.getStoredPrice(provider, modelId);
    const timestamp = Date.now();

    if (existing) {
      // Update existing - merge with existing values
      const updatedPrice: Partial<StoredPrice> = {
        modelName: price.modelName !== undefined ? price.modelName : existing.modelName,
        inputPrice: price.inputPrice !== undefined ? price.inputPrice : existing.inputPrice,
        outputPrice: price.outputPrice !== undefined ? price.outputPrice : existing.outputPrice,
        cacheReadPrice: price.cacheReadPrice !== undefined ? price.cacheReadPrice : existing.cacheReadPrice,
        cacheWritePrice: price.cacheWritePrice !== undefined ? price.cacheWritePrice : existing.cacheWritePrice,
        currency: price.currency ?? existing.currency,
        source: 'manual',
        updatedAt: timestamp,
        isOverridden: true,
      };
      this.updatePrice(provider, modelId, updatedPrice);
    } else {
      // Insert new
      this.storePrice({
        provider,
        modelId,
        modelName: price.modelName ?? null,
        inputPrice: price.inputPrice ?? null,
        outputPrice: price.outputPrice ?? null,
        cacheReadPrice: price.cacheReadPrice ?? null,
        cacheWritePrice: price.cacheWritePrice ?? null,
        currency: price.currency ?? this.config.defaultCurrency,
        source: 'manual',
        updatedAt: timestamp,
        isOverridden: true,
      });
    }

    this.refreshCache();
  }

  /**
   * Remove manual override
   */
  clearPriceOverride(provider: string, modelId: string): void {
    const stmt = this.db.prepare(
      `UPDATE model_pricing
       SET is_overridden = 0, source = 'models.dev'
       WHERE provider = ? AND model_id = ?`
    );
    stmt.run(provider, modelId);

    // Clear from cache
    const key = this.buildKey(provider, modelId);
    this.prices.delete(key);
  }

  /**
   * Start auto-sync
   */
  startAutoSync(intervalMs?: number): void {
    // Stop existing timer if any
    this.stopAutoSync();

    const interval = intervalMs ?? this.config.autoSyncIntervalMs;

    // Run immediately
    this.syncFromUpstream().catch(console.error);

    // Schedule periodic sync
    this.syncTimer = setInterval(() => {
      this.syncFromUpstream().catch(console.error);
    }, interval);
  }

  /**
   * Stop auto-sync
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
  }

  /**
   * Check if auto-sync is running
   */
  isAutoSyncRunning(): boolean {
    return this.syncTimer !== undefined;
  }

  /**
   * Get sync history
   */
  getSyncHistory(limit: number = 100): PriceSyncLogRecord[] {
    const stmt = this.db.prepare(
      `SELECT id, synced_at, models_updated, models_added, error
       FROM price_sync_log
       ORDER BY synced_at DESC
       LIMIT ?`
    );

    const rows = stmt.all(limit) as Array<{
      id: number;
      synced_at: number;
      models_updated: number;
      models_added: number;
      error: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      syncedAt: row.synced_at,
      modelsUpdated: row.models_updated,
      modelsAdded: row.models_added,
      error: row.error,
    }));
  }

  /**
   * Get all prices
   */
  getAllPrices(options?: { overridesOnly?: boolean }): ModelPrice[] {
    let sql = `SELECT provider, model_id, model_name, input_price, output_price,
                      cache_read_price, cache_write_price, currency
               FROM model_pricing`;
    const params: unknown[] = [];

    if (options?.overridesOnly) {
      sql += ` WHERE is_overridden = 1`;
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      provider: string;
      model_id: string;
      model_name: string | null;
      input_price: number | null;
      output_price: number | null;
      cache_read_price: number | null;
      cache_write_price: number | null;
      currency: string;
    }>;

    return rows.map((row) => {
      const price: ModelPrice = {
        provider: row.provider,
        modelId: row.model_id,
        modelName: row.model_name ?? undefined,
        inputPrice: row.input_price ?? 0,
        outputPrice: row.output_price ?? 0,
        currency: row.currency,
      };

      if (row.cache_read_price !== null) {
        price.cacheReadPrice = row.cache_read_price;
      }
      if (row.cache_write_price !== null) {
        price.cacheWritePrice = row.cache_write_price;
      }

      return price;
    });
  }

  // === Private Methods ===

  private buildKey(provider: string, modelId: string): string {
    return `${provider}:${modelId}`;
  }

  private storePrice(price: NewStoredPrice): void {
    const stmt = this.db.prepare(
      `INSERT INTO model_pricing
       (provider, model_id, model_name, input_price, output_price,
        cache_read_price, cache_write_price, currency, source, updated_at, is_overridden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.run(
      price.provider,
      price.modelId,
      price.modelName ?? null,
      price.inputPrice ?? null,
      price.outputPrice ?? null,
      price.cacheReadPrice ?? null,
      price.cacheWritePrice ?? null,
      price.currency,
      price.source ?? 'models.dev',
      price.updatedAt,
      price.isOverridden ? 1 : 0
    );
  }

  private updatePrice(
    provider: string,
    modelId: string,
    price: Partial<StoredPrice>
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (price.modelName !== undefined) {
      sets.push('model_name = ?');
      params.push(price.modelName);
    }
    if (price.inputPrice !== undefined) {
      sets.push('input_price = ?');
      params.push(price.inputPrice);
    }
    if (price.outputPrice !== undefined) {
      sets.push('output_price = ?');
      params.push(price.outputPrice);
    }
    if (price.cacheReadPrice !== undefined) {
      sets.push('cache_read_price = ?');
      params.push(price.cacheReadPrice);
    }
    if (price.cacheWritePrice !== undefined) {
      sets.push('cache_write_price = ?');
      params.push(price.cacheWritePrice);
    }
    if (price.currency !== undefined) {
      sets.push('currency = ?');
      params.push(price.currency);
    }
    if (price.source !== undefined) {
      sets.push('source = ?');
      params.push(price.source);
    }
    if (price.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      params.push(price.updatedAt);
    }
    if (price.isOverridden !== undefined) {
      sets.push('is_overridden = ?');
      params.push(price.isOverridden ? 1 : 0);
    }

    if (sets.length === 0) return;

    params.push(provider, modelId);

    const stmt = this.db.prepare(
      `UPDATE model_pricing SET ${sets.join(', ')} WHERE provider = ? AND model_id = ?`
    );
    stmt.run(...params);
  }

  private getStoredPrice(provider: string, modelId: string): StoredPrice | null {
    const stmt = this.db.prepare(
      `SELECT id, provider, model_id, model_name, input_price, output_price,
              cache_read_price, cache_write_price, currency, source, updated_at, is_overridden
       FROM model_pricing
       WHERE provider = ? AND model_id = ?`
    );

    const row = stmt.get(provider, modelId) as {
      id: number;
      provider: string;
      model_id: string;
      model_name: string | null;
      input_price: number | null;
      output_price: number | null;
      cache_read_price: number | null;
      cache_write_price: number | null;
      currency: string;
      source: string | null;
      updated_at: number;
      is_overridden: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      provider: row.provider,
      modelId: row.model_id,
      modelName: row.model_name,
      inputPrice: row.input_price,
      outputPrice: row.output_price,
      cacheReadPrice: row.cache_read_price,
      cacheWritePrice: row.cache_write_price,
      currency: row.currency,
      source: row.source,
      updatedAt: row.updated_at,
      isOverridden: row.is_overridden === 1,
    };
  }

  private hasPriceChanged(existing: StoredPrice, incoming: ModelPrice): boolean {
    return (
      (existing.inputPrice ?? 0) !== incoming.inputPrice ||
      (existing.outputPrice ?? 0) !== incoming.outputPrice ||
      (existing.cacheReadPrice ?? undefined) !== incoming.cacheReadPrice ||
      (existing.cacheWritePrice ?? undefined) !== incoming.cacheWritePrice ||
      existing.currency !== incoming.currency
    );
  }

  private refreshCache(): void {
    this.prices.clear();

    const stmt = this.db.prepare(
      `SELECT provider, model_id, model_name, input_price, output_price,
              cache_read_price, cache_write_price, currency
       FROM model_pricing`
    );

    const rows = stmt.all() as Array<{
      provider: string;
      model_id: string;
      model_name: string | null;
      input_price: number | null;
      output_price: number | null;
      cache_read_price: number | null;
      cache_write_price: number | null;
      currency: string;
    }>;

    for (const row of rows) {
      const price: ModelPrice = {
        provider: row.provider,
        modelId: row.model_id,
        modelName: row.model_name ?? undefined,
        inputPrice: row.input_price ?? 0,
        outputPrice: row.output_price ?? 0,
        currency: row.currency,
      };

      if (row.cache_read_price !== null) {
        price.cacheReadPrice = row.cache_read_price;
      }
      if (row.cache_write_price !== null) {
        price.cacheWritePrice = row.cache_write_price;
      }

      this.prices.set(this.buildKey(row.provider, row.model_id), price);
    }
  }

  private logSync(result: PriceSyncResult): void {
    const stmt = this.db.prepare(
      `INSERT INTO price_sync_log
       (synced_at, models_updated, models_added, error)
       VALUES (?, ?, ?, ?)`
    );

    stmt.run(
      result.timestamp,
      result.updated,
      result.added,
      result.error ?? null
    );
  }
}

// === Utility Functions ===

export function createPriceManager(
  db: Database,
  config?: Partial<PriceSyncConfig>
): PriceManager {
  return new PriceManager(db, config);
}
