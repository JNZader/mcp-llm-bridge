/**
 * Simple in-memory rate limiter for protecting authentication endpoints.
 *
 * Uses a sliding window approach to track requests per IP.
 * Note: This is per-process; in multi-instance deployments,
 * consider using Redis for distributed rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Configuration for rate limiting.
 */
export interface RateLimitConfig {
  /** Maximum requests per window. Default: 100 */
  max: number;
  /** Window size in milliseconds. Default: 15 minutes */
  windowMs: number;
}

/**
 * Simple in-memory rate limiter.
 */
export class RateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly config: Required<RateLimitConfig>;
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: RateLimitConfig = { max: 100, windowMs: 15 * 60 * 1000 }) {
    this.config = {
      max: config.max ?? 100,
      windowMs: config.windowMs ?? 15 * 60 * 1000,
    };

    // Periodic cleanup of expired entries (every 5 minutes)
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    // Allow the process to exit even if the interval is still active
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop the cleanup interval and release resources.
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.entries.clear();
  }

  /**
   * Check if a request from the given key should be rate limited.
   *
   * @param key - Identifier (e.g., IP address, or combined IP+token)
   * @returns true if the request should be blocked, false if allowed
   */
  isRateLimited(key: string): boolean {
    const now = Date.now();
    const entry = this.entries.get(key);

    if (!entry || entry.resetAt < now) {
      // Start a new window
      this.entries.set(key, {
        count: 1,
        resetAt: now + this.config.windowMs,
      });
      return false;
    }

    if (entry.count >= this.config.max) {
      return true;
    }

    entry.count++;
    return false;
  }

  /**
   * Get remaining requests for a key.
   */
  getRemaining(key: string): number {
    const now = Date.now();
    const entry = this.entries.get(key);

    if (!entry || entry.resetAt < now) {
      return this.config.max;
    }

    return Math.max(0, this.config.max - entry.count);
  }

  /**
   * Get reset time for a key (Unix timestamp in ms).
   */
  getResetAt(key: string): number {
    const now = Date.now();
    const entry = this.entries.get(key);

    if (!entry || entry.resetAt < now) {
      return now + this.config.windowMs;
    }

    return entry.resetAt;
  }

  /**
   * Clean up expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAt < now) {
        this.entries.delete(key);
      }
    }
  }
}

/**
 * Lazily-created default rate limiter instance.
 * Avoids creating a setInterval at module import time.
 */
let _defaultRateLimiter: RateLimiter | null = null;

export function getDefaultRateLimiter(): RateLimiter {
  if (!_defaultRateLimiter) {
    _defaultRateLimiter = new RateLimiter();
  }
  return _defaultRateLimiter;
}
