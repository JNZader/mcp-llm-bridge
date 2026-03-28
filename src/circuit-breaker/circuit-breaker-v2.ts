/**
 * Circuit Breaker V2 — 3-state with exponential backoff.
 *
 * Octopus-style per-(provider, key, model) granularity with CLOSED/OPEN/HALF_OPEN states.
 * Exponential backoff: cooldown doubles after each trip (60s → 120s → 240s... capped at 10min).
 */

// ── Const Types Pattern (REQUIRED by TypeScript skill) ──────────────────────

const CIRCUIT_STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
} as const;

export type CircuitState = (typeof CIRCUIT_STATE)[keyof typeof CIRCUIT_STATE];

export const CircuitState = CIRCUIT_STATE;

// ── Configuration Interfaces (Flat per TypeScript skill) ──────────────────────

export interface CircuitBreakerConfig {
  /** Failures required to trip OPEN (default: 5) */
  failureThreshold: number;
  /** Initial cooldown in ms after first trip (default: 60000 = 60s) */
  baseCooldownMs: number;
  /** Maximum cooldown cap in ms (default: 600000 = 10min) */
  maxCooldownMs: number;
  /** Number of successful test requests to close from HALF_OPEN (default: 3) */
  halfOpenMaxRequests: number;
}

export interface CircuitBreakerEntry {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
  tripCount: number;
  halfOpenRequests: number;
}

interface CanExecuteResult {
  allowed: boolean;
  state: CircuitState;
  remainingCooldown?: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  baseCooldownMs: 60_000, // 60 seconds
  maxCooldownMs: 600_000, // 10 minutes
  halfOpenMaxRequests: 3,
};

// ── Circuit Breaker V2 Implementation ────────────────────────────────────────

export class CircuitBreakerV2 {
  private circuits: Map<string, CircuitBreakerEntry>;
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.circuits = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Build circuit key from provider, key, and model.
   */
  private buildKey(provider: string, key: string, model: string): string {
    return `${provider}:${key}:${model}`;
  }

  /**
   * Get or create circuit entry.
   */
  private getOrCreateEntry(provider: string, key: string, model: string): CircuitBreakerEntry {
    const circuitKey = this.buildKey(provider, key, model);

    if (!this.circuits.has(circuitKey)) {
      const newEntry: CircuitBreakerEntry = {
        state: CIRCUIT_STATE.CLOSED,
        consecutiveFailures: 0,
        lastFailureTime: 0,
        tripCount: 0,
        halfOpenRequests: 0,
      };
      this.circuits.set(circuitKey, newEntry);
    }

    return this.circuits.get(circuitKey)!;
  }

  /**
   * Calculate cooldown with exponential backoff.
   * Formula: base * 2^(tripCount - 1), capped at maxCooldownMs
   */
  private getCooldown(tripCount: number): number {
    const base = this.config.baseCooldownMs;
    const max = this.config.maxCooldownMs;

    // 60s, 120s, 240s, 480s, 960s, capped at 600s
    const cooldown = base * Math.pow(2, tripCount - 1);
    return Math.min(cooldown, max);
  }

  /**
   * Transition circuit to HALF_OPEN state.
   */
  private transitionToHalfOpen(entry: CircuitBreakerEntry): void {
    entry.state = CIRCUIT_STATE.HALF_OPEN;
    entry.halfOpenRequests = 0;
  }

  /**
   * Transition circuit to CLOSED state.
   */
  private transitionToClosed(entry: CircuitBreakerEntry): void {
    entry.state = CIRCUIT_STATE.CLOSED;
    entry.consecutiveFailures = 0;
    // NOTE: tripCount is NOT reset here - it accumulates for exponential backoff
    entry.halfOpenRequests = 0;
  }

  /**
   * Transition circuit to OPEN state.
   */
  private transitionToOpen(entry: CircuitBreakerEntry): void {
    entry.state = CIRCUIT_STATE.OPEN;
    entry.lastFailureTime = Date.now();
    entry.tripCount++;
  }

  /**
   * Check if request is allowed for the given provider/key/model combo.
   */
  canExecute(provider: string, key: string, model: string): CanExecuteResult {
    const entry = this.getOrCreateEntry(provider, key, model);

    switch (entry.state) {
      case CIRCUIT_STATE.CLOSED:
        return { allowed: true, state: CIRCUIT_STATE.CLOSED };

      case CIRCUIT_STATE.OPEN: {
        const cooldown = this.getCooldown(entry.tripCount);
        const elapsed = Date.now() - entry.lastFailureTime;
        const remainingCooldown = cooldown - elapsed;

        if (remainingCooldown <= 0) {
          // Transition to HALF_OPEN and allow request
          this.transitionToHalfOpen(entry);
          return { allowed: true, state: CIRCUIT_STATE.HALF_OPEN };
        }

        return {
          allowed: false,
          state: CIRCUIT_STATE.OPEN,
          remainingCooldown,
        };
      }

      case CIRCUIT_STATE.HALF_OPEN:
        // Count the test request
        entry.halfOpenRequests++;
        return { allowed: true, state: CIRCUIT_STATE.HALF_OPEN };

      default:
        // Exhaustive check - should never happen with const types
        return { allowed: true, state: CIRCUIT_STATE.CLOSED };
    }
  }

  /**
   * Record a successful request.
   */
  recordSuccess(provider: string, key: string, model: string): void {
    const entry = this.getOrCreateEntry(provider, key, model);

    switch (entry.state) {
      case CIRCUIT_STATE.HALF_OPEN:
        // Check if we've reached the success threshold
        if (entry.halfOpenRequests >= this.config.halfOpenMaxRequests) {
          this.transitionToClosed(entry);
        }
        break;

      case CIRCUIT_STATE.CLOSED:
        // Reset failure count on success
        entry.consecutiveFailures = 0;
        break;

      case CIRCUIT_STATE.OPEN:
        // Should not happen - ignore
        break;
    }
  }

  /**
   * Record a failed request.
   */
  recordFailure(provider: string, key: string, model: string): void {
    const entry = this.getOrCreateEntry(provider, key, model);

    switch (entry.state) {
      case CIRCUIT_STATE.HALF_OPEN:
        // Any failure in HALF_OPEN immediately goes back to OPEN
        // NOTE: Don't increment tripCount here - we're still in the same trip
        entry.state = CIRCUIT_STATE.OPEN;
        entry.lastFailureTime = Date.now();
        entry.consecutiveFailures = 0;
        break;

      case CIRCUIT_STATE.CLOSED:
        entry.lastFailureTime = Date.now();
        entry.consecutiveFailures++;
        if (entry.consecutiveFailures >= this.config.failureThreshold) {
          this.transitionToOpen(entry);
        }
        break;

      case CIRCUIT_STATE.OPEN:
        // Already open - update last failure time
        entry.lastFailureTime = Date.now();
        break;
    }
  }

  /**
   * Get current state for monitoring.
   */
  getState(provider: string, key: string, model: string): CircuitBreakerEntry | null {
    const circuitKey = this.buildKey(provider, key, model);
    const entry = this.circuits.get(circuitKey);

    if (!entry) return null;

    // Return a copy to prevent external mutation
    return { ...entry };
  }

  /**
   * Get all circuit states (for monitoring/debugging).
   */
  getAllStates(): Array<{ key: string; entry: CircuitBreakerEntry }> {
    return Array.from(this.circuits.entries()).map(([key, entry]) => ({
      key,
      entry: { ...entry },
    }));
  }

  /**
   * Reset a specific circuit to CLOSED state.
   */
  reset(provider: string, key: string, model: string): void {
    const circuitKey = this.buildKey(provider, key, model);
    const entry = this.circuits.get(circuitKey);

    if (entry) {
      this.transitionToClosed(entry);
    }
  }

  /**
   * Get current config.
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Update config at runtime.
   */
  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Error thrown when circuit breaker is open.
 */
export class CircuitBreakerOpenError extends Error {
  readonly provider: string;
  readonly key: string;
  readonly model: string;

  constructor(provider: string, key: string, model: string) {
    super(`Circuit breaker is open for ${provider}:${key}:${model}`);
    this.name = 'CircuitBreakerOpenError';
    this.provider = provider;
    this.key = key;
    this.model = model;
  }
}
