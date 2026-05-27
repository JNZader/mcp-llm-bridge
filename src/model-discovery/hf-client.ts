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
    // Check SQLite cache first if available
    if (this.db) {
      try {
        const row = this.db
          .prepare('SELECT metadata, fetched_at FROM hf_model_cache WHERE hf_model_id = ?')
          .get(hfModelId) as { metadata: string; fetched_at: string } | undefined;
        if (row) {
          const fetchedAt = new Date(row.fetched_at).getTime();
          if (Date.now() - fetchedAt < this.config.cacheTtlSec * 1000) {
            return JSON.parse(row.metadata) as HFModelMetadata;
          }
        }
      } catch {
        // SQLite read failed — fall through to in-memory / network
      }
    }

    // Check in-memory cache
    const cached = this.cache.get(hfModelId);
    if (cached && Date.now() - cached.fetchedAt < this.config.cacheTtlSec * 1000) {
      return cached.metadata;
    }

    try {
      const url = `${this.config.hfApiUrl}/models/${hfModelId}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.hfTimeoutMs);

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
        this.storeInCache(hfModelId, null);
        return null;
      }

      const body = await response.json() as HFApiModelResponse;
      const metadata = parseHFResponse(body);

      this.storeInCache(hfModelId, metadata);
      return metadata;
    } catch {
      // Network error — cache the miss to avoid hammering
      this.storeInCache(hfModelId, null);
      return null;
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
