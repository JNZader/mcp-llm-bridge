/**
 * Load Balancer Module
 *
 * Feature 7: 4 Load Balancing Modes
 * Re-exports all balancer types and implementations
 */

// Types
export {
  LOAD_BALANCE_MODE,
  DEFAULT_LOAD_BALANCE_MODE,
  DEFAULT_BALANCER_CONFIG,
  type LoadBalanceMode,
  type ProviderCandidate,
  type BalancerConfig,
  type BalancerStrategy,
  type BalancerSelection,
  isLoadBalanceMode,
  isProviderCandidate,
  isBalancerConfig,
} from './types.js';

// Strategies
export {
  RoundRobinStrategy,
  RandomStrategy,
  FailoverStrategy,
  WeightedStrategy,
  createStrategy,
  getStrategyDescription,
} from './strategies.js';

// Main Balancer
export {
  LoadBalancer,
  createBalancerFromString,
  getAllLoadBalanceModes,
} from './balancer.js';
