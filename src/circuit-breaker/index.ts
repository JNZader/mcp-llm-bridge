/**
 * Circuit Breaker module exports.
 *
 * Provides V2 implementation with 3-state (CLOSED/OPEN/HALF_OPEN) and exponential backoff.
 */

export {
  CircuitBreakerV2,
  CircuitState,
  type CircuitState as CircuitStateType,
  type CircuitBreakerConfig,
  type CircuitBreakerEntry,
  CircuitBreakerOpenError,
} from './circuit-breaker-v2.js';
