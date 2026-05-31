/**
 * HuggingFace API client — fetch model metadata for enrichment.
 *
 * Lightweight client that queries the HuggingFace model API
 * to get metadata like downloads, tags, pipeline type, and license.
 * Supports both in-memory and SQLite-backed caching.
 */

import type { HFModelMetadata, ModelDiscoveryConfig } from './types.js';
import { DEFAULT_DISCOVERY_CONFIG } from './types.js';
import type Database from 'better-sqlite3';

export interface FetchMetadataOptions {
  timeoutMs?: number;
  allowStale?: boolean;
}

export interface FetchMetadataResult {
  metadata: HFModelMetadata | null;
  error: string | null;
  stale: boolean;
}

/**
 * Raw HuggingFace API response for a model (minimal subset).
 */
interface HFApiModelResponse {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  pipeline_tag?: string;
  tags?: string[];
  cardData?: {
    license?: string;
  };
  gated?: boolean | string;
  lastModified?: string;
  library_name?: string;
}

/**
 * In-memory cache entry for HF metadata.
 */
interface CacheEntry {
  metadata: HFModelMetadata | null;
  fetchedAt: number;
}

interface SqliteCacheRow {
  metadata: string;
  fetched_at: string;
}

/**
 * HuggingFace metadata client with caching.
 *
 * When a `db` is provided, the cache is persisted to SQLite
 * (`hf_model_cache` table) so it survives restarts.
 */
export class HFClient {
  private readonly config: ModelDiscoveryConfig;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly db: Database.Database | null;

  constructor(config?: Partial<ModelDiscoveryConfig>, db?: Database.Database) {
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
    this.db = db ?? null;
  }

  /**
   * Fetch metadata for a HuggingFace model ID.
   *
   * Returns cached result if available and fresh. Returns null
   * if the model is not found or the API is unreachable.
   */
  async fetchMetadata(hfModelId: string): Promise<HFModelMetadata | null> {
    const result = await this.fetchMetadataWithStatus(hfModelId);
    return result.metadata;
  }

  async fetchMetadataWithStatus(
    hfModelId: string,
    options?: FetchMetadataOptions,
  ): Promise<FetchMetadataResult> {
    const allowStale = options?.allowStale !== false;
    const ttlMs = this.config.cacheTtlSec * 1000;

    // Check SQLite cache first if available
    const sqliteRow = this.readSqliteCache(hfModelId);
    const staleSqlite = sqliteRow ? this.parseSqliteCacheRow(sqliteRow) : null;
    if (this.db) {
      if (staleSqlite && Date.now() - staleSqlite.fetchedAt < ttlMs) {
        return { metadata: staleSqlite.metadata, error: null, stale: false };
      }
    }

    // Check in-memory cache
    const cached = this.cache.get(hfModelId);
    const staleMemory = cached ?? null;
    if (cached && Date.now() - cached.fetchedAt < ttlMs) {
      return { metadata: cached.metadata, error: null, stale: false };
    }

    try {
      const url = `${this.config.hfApiUrl}/models/${hfModelId}`;
      const controller = new AbortController();
      const timeoutMs = Math.max(1, options?.timeoutMs ?? this.config.hfTimeoutMs);
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (this.config.hfToken) {
        headers['Authorization'] = `Bearer ${this.config.hfToken}`;
      }

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        return this.fallbackToStale(
          hfModelId,
          `HTTP ${response.status}: ${response.statusText}`,
          staleMemory,
          staleSqlite,
          allowStale,
        );
      }

      const body = await response.json() as HFApiModelResponse;
      const metadata = parseHFResponse(body);

      this.storeInCache(hfModelId, metadata);
      return { metadata, error: null, stale: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.fallbackToStale(
        hfModelId,
        message,
        staleMemory,
        staleSqlite,
        allowStale,
      );
    }
  }

  /**
   * Store metadata in both in-memory and SQLite caches.
   */
  private storeInCache(hfModelId: string, metadata: HFModelMetadata | null): void {
    const now = Date.now();
    this.cache.set(hfModelId, { metadata, fetchedAt: now });

    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO hf_model_cache (hf_model_id, metadata, fetched_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(hf_model_id) DO UPDATE SET
            metadata = excluded.metadata,
            fetched_at = excluded.fetched_at
        `).run(hfModelId, JSON.stringify(metadata));
      } catch {
        // SQLite write failed — in-memory cache still holds the value
      }
    }
  }

  /**
   * Clear the metadata cache.
   */
  clearCache(): void {
    this.cache.clear();
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM hf_model_cache').run();
      } catch {
        // Non-critical
      }
    }
  }

  /**
   * Get current cache size (in-memory only).
   */
  get cacheSize(): number {
    return this.cache.size;
  }

  private fallbackToStale(
    hfModelId: string,
    reason: string,
    staleMemory: CacheEntry | null,
    staleSqlite: CacheEntry | null,
    allowStale: boolean,
  ): FetchMetadataResult {
    if (allowStale) {
      const stale = staleMemory ?? staleSqlite;
      if (stale) {
        return {
          metadata: stale.metadata,
          error: `HF metadata lookup failed for ${hfModelId}: ${reason}; using stale cache`,
          stale: true,
        };
      }
    }

    return {
      metadata: null,
      error: `HF metadata lookup failed for ${hfModelId}: ${reason}`,
      stale: false,
    };
  }

  private readSqliteCache(hfModelId: string): SqliteCacheRow | null {
    if (!this.db) {
      return null;
    }

    try {
      return (
        (this.db
          .prepare('SELECT metadata, fetched_at FROM hf_model_cache WHERE hf_model_id = ?')
          .get(hfModelId) as SqliteCacheRow | undefined) ?? null
      );
    } catch {
      return null;
    }
  }

  private parseSqliteCacheRow(row: SqliteCacheRow): CacheEntry | null {
    try {
      return {
        metadata: JSON.parse(row.metadata) as HFModelMetadata | null,
        fetchedAt: new Date(row.fetched_at).getTime(),
      };
    } catch {
      return null;
    }
  }
}

/**
 * Parse raw HF API response into typed metadata.
 */
function parseHFResponse(body: HFApiModelResponse): HFModelMetadata {
  return {
    hfModelId: body.id,
    author: body.author ?? '',
    downloads: body.downloads ?? 0,
    likes: body.likes ?? 0,
    pipelineTag: body.pipeline_tag,
    tags: body.tags ?? [],
    license: body.cardData?.license,
    gated: body.gated === true || body.gated === 'auto',
    lastModified: body.lastModified,
    libraryName: body.library_name,
  };
}
