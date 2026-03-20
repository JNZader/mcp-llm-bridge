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

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenSuccessThreshold: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenSuccessThreshold: 2,
};

/**
 * Circuit breaker for a single provider.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;
  private halfOpenSuccesses = 0;

  private readonly name: string;
  private readonly config: CircuitBreakerConfig;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if requests are allowed through.
   */
  canRequest(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        // Check if timeout has elapsed
        if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
          this.state = CircuitState.HALF_OPEN;
          this.halfOpenSuccesses = 0;
          return true;
        }
        return false;
      case CircuitState.HALF_OPEN:
        return true;
    }
  }

  /**
   * Record a successful request.
   */
  recordSuccess(): void {
    switch (this.state) {
      case CircuitState.HALF_OPEN:
        this.halfOpenSuccesses++;
        if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
          this.state = CircuitState.CLOSED;
          this.failures = 0;
        }
        break;
      case CircuitState.CLOSED:
        // Reset failure count on success
        this.failures = 0;
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
   * Get stats for monitoring.
   */
  getStats(): { name: string; state: CircuitState; failures: number } {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
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
    }
  }
}

/**
 * Registry of circuit breakers for all providers.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled && process.env['LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED'] !== 'false';
  }

  /**
   * Get or create a circuit breaker for a provider.
   */
  get(name: string): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name));
    }
    return this.breakers.get(name)!;
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
  getAllStats(): Array<{ name: string; state: CircuitState; failures: number }> {
    return Array.from(this.breakers.values()).map((cb) => cb.getStats());
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
 * Execute a function with circuit breaker protection.
 */
export async function withCircuitBreaker<T>(
  providerId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const registry = getCircuitBreakerRegistry();
  const breaker = registry.get(providerId);

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
