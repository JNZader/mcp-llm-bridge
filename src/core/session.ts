/**
 * Session Stickiness — pins (clientId + model) to a specific provider.
 *
 * In-memory Map with configurable TTL per entry and periodic sweep
 * to evict expired sessions. Designed for load-balanced groups where
 * the same client should hit the same provider for a while.
 *
 * Has destroy() for cleanup (prevents interval leaks).
 */

/** A pinned session entry. */
interface SessionEntry {
  provider: string;
  keyName: string;
  expiresAt: number;
}

/** Default sweep interval: every 60 seconds. */
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export class SessionStore {
  private readonly sessions = new Map<string, SessionEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS) {
    // Start periodic sweep to evict expired entries
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    // Unref so it doesn't keep the process alive
    if (typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }

  /**
   * Build the session key from clientId and model.
   */
  private key(clientId: string, model: string): string {
    return `${clientId}:${model}`;
  }

  /**
   * Pin a client+model to a specific provider.
   *
   * @param clientId - The client identifier
   * @param model - The model being requested
   * @param provider - The provider to pin to
   * @param keyName - The key name (slot) on the provider
   * @param ttlMs - Time-to-live in milliseconds
   */
  pin(
    clientId: string,
    model: string,
    provider: string,
    keyName: string,
    ttlMs: number,
  ): void {
    const k = this.key(clientId, model);
    this.sessions.set(k, {
      provider,
      keyName,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Get the pinned provider for a client+model, or null if expired/missing.
   */
  get(
    clientId: string,
    model: string,
  ): { provider: string; keyName: string } | null {
    const k = this.key(clientId, model);
    const entry = this.sessions.get(k);

    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      // Expired — evict lazily
      this.sessions.delete(k);
      return null;
    }

    return { provider: entry.provider, keyName: entry.keyName };
  }

  /**
   * Remove a specific session pin.
   */
  unpin(clientId: string, model: string): void {
    this.sessions.delete(this.key(clientId, model));
  }

  /**
   * Remove all expired entries. Called periodically by the sweep timer.
   */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now >= entry.expiresAt) {
        this.sessions.delete(key);
      }
    }
  }

  /**
   * Number of active (non-expired) sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Destroy the store and clean up the sweep interval.
   * MUST be called to prevent interval leaks.
   */
  destroy(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.sessions.clear();
  }
}
