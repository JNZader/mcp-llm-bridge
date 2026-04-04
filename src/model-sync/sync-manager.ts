/**
 * Model Sync Manager
 *
 * Orchestrates model synchronization with auto-sync capability.
 */

import {
  type ModelInfo,
  type ModelSyncConfig,
  type ModelSyncResult,
  type ProviderType,
  type ModelSyncLogRecord,
} from './types.js';
import { getFetcherForProvider } from './fetcher.js';

// === Database Interface (minimal, to be implemented by consumer) ===

export interface Database {
  prepare(sql: string): Statement;
}

export interface Statement {
  run(...params: unknown[]): { lastInsertRowid: number };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown | undefined;
}

// === Sync Manager ===

export class ModelSyncManager {
  private db: Database;
  private syncTimers: Map<ProviderType, NodeJS.Timeout> = new Map();

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Sync models for a provider
   */
  async syncProvider(config: ModelSyncConfig): Promise<ModelSyncResult> {
    try {
      // Get fetcher for provider
      const fetcher = getFetcherForProvider(config.provider);
      if (!fetcher) {
        throw new Error(`No fetcher for provider: ${config.provider}`);
      }

      // Fetch models from provider
      const models = await fetcher.fetchModels(config.baseUrl, config.apiKey);

      // Filter by regex if provided
      const filteredModels = this.filterByRegex(models, config.matchRegex);

      // Diff with existing
      const existing = this.getExistingModels(config.provider);
      const { added, removed } = this.diffModels(existing, filteredModels);

      // Update database
      this.updateDatabase(config.provider, filteredModels, config.matchRegex);

      // Log sync
      const result: ModelSyncResult = {
        provider: config.provider,
        timestamp: Date.now(),
        modelsFound: filteredModels,
        modelsAdded: added,
        modelsRemoved: removed.map((m) => m.id),
      };

      this.logSync(result);

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const result: ModelSyncResult = {
        provider: config.provider,
        timestamp: Date.now(),
        modelsFound: [],
        modelsAdded: [],
        modelsRemoved: [],
        error: errorMessage,
      };

      this.logSync(result);
      throw error;
    }
  }

  /**
   * Filter models by regex pattern
   */
  private filterByRegex(
    models: ModelInfo[],
    regexPattern?: string
  ): ModelInfo[] {
    if (!regexPattern) return models;

    try {
      const regex = new RegExp(regexPattern);
      return models.filter((m) => regex.test(m.id));
    } catch {
      // Invalid regex, return all models
      return models;
    }
  }

  /**
   * Get existing models from database
   */
  private getExistingModels(provider: ProviderType): ModelInfo[] {
    const stmt = this.db.prepare(
      `SELECT model_id, model_name, model_description, context_length, 
              pricing_input, pricing_output
       FROM provider_models 
       WHERE provider = ? AND is_active = 1`
    );

    const rows = stmt.all(provider) as Array<{
      model_id: string;
      model_name: string | null;
      model_description: string | null;
      context_length: number | null;
      pricing_input: number | null;
      pricing_output: number | null;
    }>;

    return rows.map((row) => {
      const model: ModelInfo = {
        id: row.model_id,
        name: row.model_name ?? undefined,
        description: row.model_description ?? undefined,
        contextLength: row.context_length ?? undefined,
      };

      if (row.pricing_input !== null || row.pricing_output !== null) {
        model.pricing = {
          input: row.pricing_input ?? 0,
          output: row.pricing_output ?? 0,
        };
      }

      return model;
    });
  }

  /**
   * Diff discovered models with existing
   */
  private diffModels(
    existing: ModelInfo[],
    discovered: ModelInfo[]
  ): { added: ModelInfo[]; removed: ModelInfo[] } {
    const existingIds = new Set(existing.map((m) => m.id));
    const discoveredIds = new Set(discovered.map((m) => m.id));

    const added = discovered.filter((m) => !existingIds.has(m.id));
    const removed = existing.filter((m) => !discoveredIds.has(m.id));

    return { added, removed };
  }

  /**
   * Update database with discovered models
   */
  private updateDatabase(
    provider: ProviderType,
    models: ModelInfo[],
    matchRegex?: string
  ): void {
    const timestamp = Date.now();

    // Soft-delete existing models for this provider
    const deleteStmt = this.db.prepare(
      `UPDATE provider_models 
       SET is_active = 0, last_synced_at = ? 
       WHERE provider = ?`
    );
    deleteStmt.run(timestamp, provider);

    // Insert/update models
    const upsertStmt = this.db.prepare(
      `INSERT INTO provider_models 
       (provider, model_id, model_name, model_description, context_length, 
        pricing_input, pricing_output, discovered_at, last_synced_at, is_active, match_regex)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(provider, model_id) DO UPDATE SET
       model_name = excluded.model_name,
       model_description = excluded.model_description,
       context_length = excluded.context_length,
       pricing_input = excluded.pricing_input,
       pricing_output = excluded.pricing_output,
       last_synced_at = excluded.last_synced_at,
       is_active = 1,
       match_regex = excluded.match_regex`
    );

    for (const model of models) {
      upsertStmt.run(
        provider,
        model.id,
        model.name ?? null,
        model.description ?? null,
        model.contextLength ?? null,
        model.pricing?.input ?? null,
        model.pricing?.output ?? null,
        timestamp,
        timestamp,
        matchRegex ?? null
      );
    }
  }

  /**
   * Log sync operation to history
   */
  private logSync(result: ModelSyncResult): void {
    const stmt = this.db.prepare(
      `INSERT INTO model_sync_log 
       (provider, synced_at, models_found, models_added, models_removed, error)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    stmt.run(
      result.provider,
      result.timestamp,
      result.modelsFound.length,
      result.modelsAdded.length,
      result.modelsRemoved.length,
      result.error ?? null
    );
  }

  /**
   * Start auto-sync for provider
   */
  startAutoSync(config: ModelSyncConfig): void {
    // Stop existing timer if any
    this.stopAutoSync(config.provider);

    // Run immediately
    this.syncProvider(config).catch(console.error);

    // Schedule periodic sync
    const timer = setInterval(() => {
      this.syncProvider(config).catch(console.error);
    }, config.autoSyncIntervalMs);

    this.syncTimers.set(config.provider, timer);
  }

  /**
   * Stop auto-sync for provider
   */
  stopAutoSync(provider: ProviderType): void {
    const timer = this.syncTimers.get(provider);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(provider);
    }
  }

  /**
   * Stop all auto-sync timers
   */
  stopAllAutoSync(): void {
    for (const [provider, timer] of this.syncTimers) {
      clearInterval(timer);
      this.syncTimers.delete(provider);
    }
  }

  /**
   * Get stored models for provider
   */
  getModels(
    provider: ProviderType,
    options?: { activeOnly?: boolean }
  ): ModelInfo[] {
    const activeOnly = options?.activeOnly ?? true;

    let sql = `SELECT model_id, model_name, model_description, context_length,
                      pricing_input, pricing_output
               FROM provider_models 
               WHERE provider = ?`;

    if (activeOnly) {
      sql += ` AND is_active = 1`;
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(provider) as Array<{
      model_id: string;
      model_name: string | null;
      model_description: string | null;
      context_length: number | null;
      pricing_input: number | null;
      pricing_output: number | null;
    }>;

    return rows.map((row) => {
      const model: ModelInfo = {
        id: row.model_id,
        name: row.model_name ?? undefined,
        description: row.model_description ?? undefined,
        contextLength: row.context_length ?? undefined,
      };

      if (row.pricing_input !== null || row.pricing_output !== null) {
        model.pricing = {
          input: row.pricing_input ?? 0,
          output: row.pricing_output ?? 0,
        };
      }

      return model;
    });
  }

  /**
   * Get sync history for provider
   */
  getSyncHistory(
    provider?: ProviderType,
    limit: number = 100
  ): ModelSyncLogRecord[] {
    let sql = `SELECT id, provider, synced_at, models_found, models_added, 
                      models_removed, error
               FROM model_sync_log`;
    const params: unknown[] = [];

    if (provider) {
      sql += ` WHERE provider = ?`;
      params.push(provider);
    }

    sql += ` ORDER BY synced_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      provider: string;
      synced_at: number;
      models_found: number;
      models_added: number;
      models_removed: number;
      error: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      provider: row.provider as ProviderType,
      syncedAt: row.synced_at,
      modelsFound: row.models_found,
      modelsAdded: row.models_added,
      modelsRemoved: row.models_removed,
      error: row.error,
    }));
  }

  /**
   * Check if auto-sync is running for provider
   */
  isAutoSyncRunning(provider: ProviderType): boolean {
    return this.syncTimers.has(provider);
  }

  /**
   * Get all running auto-sync providers
   */
  getRunningAutoSyncProviders(): ProviderType[] {
    return Array.from(this.syncTimers.keys());
  }
}

// === Utility Functions ===

export function createModelSyncManager(db: Database): ModelSyncManager {
  return new ModelSyncManager(db);
}
