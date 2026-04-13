/**
 * HuggingFace API client — fetch model metadata for enrichment.
 *
 * Lightweight client that queries the HuggingFace model API
 * to get metadata like downloads, tags, pipeline type, and license.
 * Includes a simple in-memory cache to avoid repeated API calls.
 */

import type { HFModelMetadata, ModelDiscoveryConfig } from './types.js';
import { DEFAULT_DISCOVERY_CONFIG } from './types.js';

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
 */
export class HFClient {
  private readonly config: ModelDiscoveryConfig;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config?: Partial<ModelDiscoveryConfig>) {
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  }

  /**
   * Fetch metadata for a HuggingFace model ID.
   *
   * Returns cached result if available and fresh. Returns null
   * if the model is not found or the API is unreachable.
   */
  async fetchMetadata(hfModelId: string): Promise<HFModelMetadata | null> {
    // Check cache
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
        this.cache.set(hfModelId, { metadata: null, fetchedAt: Date.now() });
        return null;
      }

      const body = await response.json() as HFApiModelResponse;
      const metadata = parseHFResponse(body);

      this.cache.set(hfModelId, { metadata, fetchedAt: Date.now() });
      return metadata;
    } catch {
      // Network error — cache the miss to avoid hammering
      this.cache.set(hfModelId, { metadata: null, fetchedAt: Date.now() });
      return null;
    }
  }

  /**
   * Clear the metadata cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size.
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
