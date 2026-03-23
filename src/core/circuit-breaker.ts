/**
 * Circuit Breaker pattern implementation for provider resilience.
 *
 * Prevents cascading failures by temporarily disabling providers that are
 * experiencing repeated failures.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Provider is failing, requests are rejected immediately
 * - HALF_OPEN: Testing if provider has recovered
 *
 * Granularity: breaker key = `${provider}:${apiKey}:${model}` (octopus-style).
 * Falls back to provider-only key when apiKey/model are not provided.
 *
 * Backoff: exponential backoff with configurable base, multiplier, and max.
 * Formula: cooldown = min(base * multiplier^consecutiveFailures, max)
 *
 * Configure via environment:
 * - LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED: Enable/disable (default: true)
 * - LLM_GATEWAY_CIRCUIT_BREAKER_THRESHOLD: Failures before opening (default: 5)
 * - LLM_GATEWAY_CIRCUIT_BREAKER_TIMEOUT: Seconds before half-open (default: 30)
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenSuccessThreshold: number;
  /** Exponential backoff base in ms. When set, enables exponential backoff. */
  backoffBaseMs: number | null;
  /** Exponential backoff multiplier (default: 2). */
  backoffMultiplier: number;
  /** Maximum backoff cap in ms (default: 300_000 = 5 min). */
  backoffMaxMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenSuccessThreshold: 2,
  backoffBaseMs: null, // null = use fixed resetTimeoutMs (backward compat)
  backoffMultiplier: 2,
  backoffMaxMs: 300_000,
};

/** Stats shape returned by getStats(). */
export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  currentCooldownMs: number;
  consecutiveFailures: number;
}

/**
 * Circuit breaker for a single provider (or provider:key:model combo).
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private halfOpenSuccesses = 0;
  private consecutiveFailures = 0;

  private readonly name: string;
  private config: CircuitBreakerConfig;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute the current cooldown.
   *
   * When backoffBaseMs is null (default), uses the fixed resetTimeoutMs for
   * backward compat. When backoffBaseMs is set, uses exponential backoff:
   *   cooldown = min(base * multiplier^(consecutiveFailures-1), max)
   */
  getCurrentCooldownMs(): number {
    if (this.config.backoffBaseMs === null || this.consecutiveFailures === 0) {
      return this.config.resetTimeoutMs;
    }
    const expCooldown =
      this.config.backoffBaseMs *
      Math.pow(this.config.backoffMultiplier, this.consecutiveFailures - 1);
    return Math.min(expCooldown, this.config.backoffMaxMs);
  }

  /**
   * Check if requests are allowed through.
   */
  canRequest(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN: {
        const cooldown = this.getCurrentCooldownMs();
        if (Date.now() - this.lastFailureTime >= cooldown) {
          this.state = CircuitState.HALF_OPEN;
          this.halfOpenSuccesses = 0;
          return true;
        }
        return false;
      }
      case CircuitState.HALF_OPEN:
        return true;
    }
  }

  /**
   * Record a successful request.
   */
  recordSuccess(): void {
    this.successes++;
    switch (this.state) {
      case CircuitState.HALF_OPEN:
        this.halfOpenSuccesses++;
        if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
          this.state = CircuitState.CLOSED;
          this.failures = 0;
          this.consecutiveFailures = 0;
        }
        break;
      case CircuitState.CLOSED:
        // Reset failure count on success
        this.failures = 0;
        this.consecutiveFailures = 0;
        break;
      case CircuitState.OPEN:
        // Should not happen, but handle gracefully
        break;
    }
  }

  /**
   * Record a failed request.
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.failures++;
    this.consecutiveFailures++;

    switch (this.state) {
      case CircuitState.HALF_OPEN:
        // Immediate open on failure in half-open
        this.state = CircuitState.OPEN;
        break;
      case CircuitState.CLOSED:
        if (this.failures >= this.config.failureThreshold) {
          this.state = CircuitState.OPEN;
        }
        break;
      case CircuitState.OPEN:
        // Already open, just update failure time
        break;
    }
  }

  /**
   * Get current state.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get provider name.
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get config (read-only copy).
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Update config at runtime.
   */
  updateConfig(partial: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Get stats for monitoring.
   */
  getStats(): CircuitBreakerStats {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      currentCooldownMs: this.getCurrentCooldownMs(),
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Force state change (for testing/admin).
   */
  forceState(state: CircuitState): void {
    this.state = state;
    if (state === CircuitState.CLOSED) {
      this.failures = 0;
      this.halfOpenSuccesses = 0;
      this.consecutiveFailures = 0;
    }
  }
}

/**
 * Build a circuit breaker key from provider, apiKey, and model.
 * Falls back to provider-only when optional parts are missing.
 */
export function buildBreakerKey(
  provider: string,
  apiKey?: string,
  model?: string,
): string {
  const parts = [provider];
  if (apiKey) parts.push(apiKey);
  if (model) parts.push(model);
  return parts.join(':');
}

/**
 * Registry of circuit breakers for all providers.
 *
 * Supports per-key:model granularity via buildBreakerKey().
 * Backward compatible: calling with just providerId still works.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly enabled: boolean;
  private defaultConfig: Partial<CircuitBreakerConfig> = {};

  constructor(enabled = true) {
    this.enabled = enabled && process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] !== 'false';
  }

  /**
   * Get or create a circuit breaker by key.
   * Key can be a simple provider name or a composite key.
   */
  get(name: string): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, this.defaultConfig));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get or create a circuit breaker with per-key:model granularity.
   */
  getForKey(provider: string, apiKey?: string, model?: string): CircuitBreaker {
    const key = buildBreakerKey(provider, apiKey, model);
    return this.get(key);
  }

  /**
   * Check if a provider can accept requests.
   */
  canRequest(providerId: string): boolean {
    if (!this.enabled) return true;
    return this.get(providerId).canRequest();
  }

  /**
   * Record a successful request.
   */
  recordSuccess(providerId: string): void {
    if (!this.enabled) return;
    this.get(providerId).recordSuccess();
  }

  /**
   * Record a failed request.
   */
  recordFailure(providerId: string): void {
    if (!this.enabled) return;
    this.get(providerId).recordFailure();
  }

  /**
   * Get all circuit breaker stats.
   */
  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.breakers.values()).map((cb) => cb.getStats());
  }

  /**
   * Get the default config applied to new breakers.
   */
  getDefaultConfig(): CircuitBreakerConfig {
    return { ...DEFAULT_CONFIG, ...this.defaultConfig };
  }

  /**
   * Update the default config for new breakers AND all existing breakers.
   */
  updateDefaultConfig(partial: Partial<CircuitBreakerConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...partial };
    for (const breaker of this.breakers.values()) {
      breaker.updateConfig(partial);
    }
  }

  /**
   * Whether the registry is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Global registry instance
let registry: CircuitBreakerRegistry | null = null;

/**
 * Get the global circuit breaker registry.
 */
export function getCircuitBreakerRegistry(): CircuitBreakerRegistry {
  if (!registry) {
    registry = new CircuitBreakerRegistry();
  }
  return registry;
}

/**
 * Reset the global registry (for testing).
 */
export function resetCircuitBreakerRegistry(): void {
  registry = null;
}

/**
 * Execute a function with circuit breaker protection.
 */
export async function withCircuitBreaker<T>(
  providerId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const reg = getCircuitBreakerRegistry();
  const breaker = reg.get(providerId);

  if (!breaker.canRequest()) {
    throw new CircuitBreakerOpenError(providerId);
  }

  try {
    const result = await fn();
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
}

/**
 * Error thrown when circuit breaker is open.
 */
export class CircuitBreakerOpenError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`Circuit breaker is open for provider: ${providerId}`);
    this.name = 'CircuitBreakerOpenError';
    this.providerId = providerId;
  }
}
