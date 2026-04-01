/**
 * Context Compression — CompressorService facade.
 *
 * Combines strategies, cache, and background worker into
 * a single service interface. Submit content for background
 * compression, then retrieve compressed versions instantly.
 */

import type { CompressorConfig, CompressionOptions } from './types.js';
import { DEFAULT_COMPRESSOR_CONFIG } from './types.js';
import { LRUCompressionCache } from './cache.js';
import { BackgroundCompressionWorker } from './worker.js';
import { getStrategy } from './strategies.js';

/**
 * Facade for context compression.
 *
 * Usage:
 * 1. Call submit() when new context arrives — queues for background compression
 * 2. Call getCompressed() when you need the result — returns cached or original
 * 3. Call destroy() on shutdown to clean up timers
 */
export class CompressorService {
  private readonly cache: LRUCompressionCache;
  private readonly worker: BackgroundCompressionWorker;
  private readonly config: Required<CompressorConfig>;

  constructor(config?: CompressorConfig) {
    this.config = { ...DEFAULT_COMPRESSOR_CONFIG, ...config };
    this.cache = new LRUCompressionCache(this.config.maxCacheSize);
    this.worker = new BackgroundCompressionWorker(this.cache, this.config.workerIntervalMs);
    this.worker.start();
  }

  /**
   * Submit content for background compression.
   * The content will be compressed asynchronously and cached.
   */
  submit(content: string, options?: CompressionOptions): void {
    this.worker.submit(content, this.config.defaultStrategy, options);
  }

  /**
   * Get the compressed version of content, or the original if not yet cached.
   * This is designed to be instant — never blocks on compression.
   */
  getCompressed(content: string): string {
    return this.cache.get(content) ?? content;
  }

  /**
   * Check if a compressed version is available for the given content.
   */
  hasCompressed(content: string): boolean {
    return this.cache.has(content);
  }

  /**
   * Compress content synchronously using a specific strategy.
   * Useful when you need the result immediately and can't wait for background.
   * Also caches the result.
   */
  compressNow(content: string, strategyName?: string, options?: CompressionOptions): string {
    const name = strategyName ?? this.config.defaultStrategy;
    const strategy = getStrategy(name);
    // Merge default ratio from config when no explicit options provided
    const mergedOptions: CompressionOptions = {
      ratio: this.config.defaultRatio,
      ...options,
    };
    const compressed = strategy.compress(content, mergedOptions);
    this.cache.set(content, compressed, name);
    return compressed;
  }

  /** Number of items in the compression cache. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Number of items waiting for background compression. */
  get pendingCount(): number {
    return this.worker.pendingCount;
  }

  /**
   * Destroy the service — stops the background worker and clears the cache.
   * MUST be called on shutdown to prevent interval leaks.
   */
  destroy(): void {
    this.worker.destroy();
    this.cache.clear();
  }
}
