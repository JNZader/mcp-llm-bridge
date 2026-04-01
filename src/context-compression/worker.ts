/**
 * Context Compression — background worker.
 *
 * Processes a queue of content entries asynchronously,
 * compressing them via the configured strategy and storing
 * results in the LRU cache.
 *
 * Follows the destroy() pattern from SessionStore / GroupStore.
 */

import type { CompressionQueueItem } from './types.js';
import type { LRUCompressionCache } from './cache.js';
import { getStrategy } from './strategies.js';

/**
 * Background worker that compresses queued context entries
 * on a configurable interval.
 */
export class BackgroundCompressionWorker {
  private readonly queue: CompressionQueueItem[] = [];
  private readonly cache: LRUCompressionCache;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(cache: LRUCompressionCache, intervalMs: number = 5_000) {
    this.cache = cache;
    this.intervalMs = intervalMs;
  }

  /**
   * Start the background processing loop.
   */
  start(): void {
    if (this.timer) return; // Already running

    this.timer = setInterval(() => this.processQueue(), this.intervalMs);

    // Unref so it doesn't keep the process alive (matches SessionStore pattern)
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  /**
   * Submit content for background compression.
   */
  submit(content: string, strategy: string, options?: { ratio?: number; maxChars?: number }): void {
    // Skip if already cached
    if (this.cache.has(content)) return;

    // Skip duplicates in the queue
    const alreadyQueued = this.queue.some((item) => item.content === content);
    if (alreadyQueued) return;

    this.queue.push({ content, strategy, options });
  }

  /**
   * Process all queued items. Called by the interval timer.
   * Exposed for testing.
   */
  processQueue(): void {
    // Drain the queue (splice to get a copy and clear atomically)
    const items = this.queue.splice(0);

    for (const item of items) {
      // Skip if it was cached between submission and processing
      if (this.cache.has(item.content)) continue;

      try {
        const strategy = getStrategy(item.strategy);
        const compressed = strategy.compress(item.content, item.options);
        this.cache.set(item.content, compressed, item.strategy);
      } catch {
        // Log and continue — don't let one bad item break the loop
        // In production this would use the project logger
      }
    }
  }

  /** Number of items waiting in the queue. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Stop the background worker and clear the queue.
   * MUST be called to prevent interval leaks.
   */
  destroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queue.length = 0;
  }
}
