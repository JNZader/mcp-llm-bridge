/**
 * Context Compression — LRU cache.
 *
 * Caches compressed context keyed by content hash.
 * Uses native Map insertion order for LRU eviction.
 */

/** Simple djb2 string hash — fast, non-cryptographic. */
export function contentHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return `cc_${hash.toString(36)}`;
}

/** An entry in the compression cache. */
interface CacheEntry {
  compressed: string;
  strategy: string;
  createdAt: number;
}

/**
 * LRU cache for compressed context results.
 *
 * Map preserves insertion order — on access we delete+re-insert
 * to move the entry to the end (most-recently-used). Eviction
 * removes from the front (least-recently-used).
 */
export class LRUCompressionCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;

  constructor(maxSize: number = 200) {
    this.maxSize = maxSize;
  }

  /**
   * Get a cached compressed result for the given content.
   * Returns null on cache miss. Promotes the entry on hit.
   */
  get(content: string): string | null {
    const key = contentHash(content);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Promote to most-recently-used (delete + re-insert)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.compressed;
  }

  /**
   * Store a compressed result in the cache.
   * Evicts the LRU entry if the cache is at capacity.
   */
  set(content: string, compressed: string, strategy: string): void {
    const key = contentHash(content);

    // If key already exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      compressed,
      strategy,
      createdAt: Date.now(),
    });
  }

  /**
   * Check if content has a cached compressed version.
   */
  has(content: string): boolean {
    return this.cache.has(contentHash(content));
  }

  /** Current number of entries in the cache. */
  get size(): number {
    return this.cache.size;
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear();
  }
}
