/**
 * TypeScript interfaces for Load Balancing
 *
 * Feature 7: 4 Load Balancing Modes (Round Robin, Random, Failover, Weighted)
 *
 * Supports configurable load balancing strategies for provider selection.
 */

/**
 * Load balancing modes supported by Octopus
 * Uses const object + type pattern for single source of truth
 */
export const LOAD_BALANCE_MODE = {
  ROUND_ROBIN: 'round_robin',
  RANDOM: 'random',
  FAILOVER: 'failover',
  WEIGHTED: 'weighted',
} as const;

export type LoadBalanceMode = (typeof LOAD_BALANCE_MODE)[keyof typeof LOAD_BALANCE_MODE];

/**
 * Default load balance mode
 */
export const DEFAULT_LOAD_BALANCE_MODE: LoadBalanceMode = LOAD_BALANCE_MODE.ROUND_ROBIN;

/**
 * Provider candidate for load balancing selection
 */
export interface ProviderCandidate {
  /** Unique identifier for this candidate */
  id: string;
  /** Provider name (e.g., "openai", "groq") */
  provider: string;
  /** Key ID for this provider */
  keyId: string;
  /** Model identifier */
  model: string;
  /** Priority for FAILOVER mode (lower = higher priority) */
  priority?: number;
  /** Weight for WEIGHTED mode (default: 1) */
  weight?: number;
  /** Optional latency info in milliseconds */
  latency?: number;
  /** Health status from health checks */
  healthy: boolean;
}

/**
 * Configuration for the load balancer
 */
export interface BalancerConfig {
  /** Load balancing mode to use */
  mode: LoadBalanceMode;
  /** Maximum retry attempts */
  maxRetries: number;
}

/**
 * Default balancer configuration
 */
export const DEFAULT_BALANCER_CONFIG: BalancerConfig = {
  mode: DEFAULT_LOAD_BALANCE_MODE,
  maxRetries: 3,
} as const;

/**
 * Load balancing strategy interface
 * Implementations must be stateless or properly handle reset
 */
export interface BalancerStrategy {
  /**
   * Select a provider from the candidates
   * @param candidates - Available provider candidates (pre-filtered to healthy)
   * @returns Selected candidate or null if none available
   */
  select(candidates: ProviderCandidate[]): ProviderCandidate | null;

  /**
   * Reset strategy state (for stateful strategies like Round Robin)
   * Called when switching modes
   */
  reset?(): void;
}

/**
 * Result of a load balancing selection
 */
export interface BalancerSelection {
  /** Selected candidate */
  candidate: ProviderCandidate;
  /** Strategy used for selection */
  strategy: LoadBalanceMode;
  /** Timestamp of selection */
  timestamp: number;
}

// Type guards for runtime type checking

/**
 * Check if a value is a valid LoadBalanceMode
 */
export function isLoadBalanceMode(value: unknown): value is LoadBalanceMode {
  if (typeof value !== 'string') return false;
  return Object.values(LOAD_BALANCE_MODE).includes(value as LoadBalanceMode);
}

/**
 * Check if a value is a valid ProviderCandidate
 */
export function isProviderCandidate(value: unknown): value is ProviderCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ProviderCandidate>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.provider === 'string' &&
    typeof candidate.keyId === 'string' &&
    typeof candidate.model === 'string' &&
    typeof candidate.healthy === 'boolean' &&
    (candidate.priority === undefined || typeof candidate.priority === 'number') &&
    (candidate.weight === undefined || typeof candidate.weight === 'number') &&
    (candidate.latency === undefined || typeof candidate.latency === 'number')
  );
}

/**
 * Check if a value is a valid BalancerConfig
 */
export function isBalancerConfig(value: unknown): value is BalancerConfig {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Partial<BalancerConfig>;

  return (
    (config.mode === undefined || isLoadBalanceMode(config.mode)) &&
    (config.maxRetries === undefined || typeof config.maxRetries === 'number')
  );
}
