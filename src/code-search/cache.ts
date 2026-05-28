/**
 * Embedding cache — Phase 1 in-memory skeleton.
 *
 * Phase 2 will add SQLite-backed persistence keyed by
 * file-content hash.
 */

/** Cache for dense embedding vectors. */
export interface EmbeddingCache {
  get(hash: string): Promise<Float32Array | null>;
  set(hash: string, vector: Float32Array): Promise<void>;
}

/** In-memory Map fallback (Phase 1). */
export class InMemoryEmbeddingCache implements EmbeddingCache {
  private store = new Map<string, Float32Array>();

  async get(hash: string): Promise<Float32Array | null> {
    const cached = this.store.get(hash);
    if (!cached) return null;
    // Return a copy so callers cannot mutate the cache.
    return new Float32Array(cached);
  }

  async set(hash: string, vector: Float32Array): Promise<void> {
    // Store a copy so callers cannot mutate the cache.
    this.store.set(hash, new Float32Array(vector));
  }
}
