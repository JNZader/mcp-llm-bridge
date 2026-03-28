/**
 * Main Load Balancer
 *
 * Orchestrates load balancing strategies and manages provider selection.
 * Filters to healthy candidates only and handles strategy switching.
 */

import {
  ProviderCandidate,
  BalancerConfig,
  BalancerStrategy,
  LoadBalanceMode,
  DEFAULT_BALANCER_CONFIG,
  LOAD_BALANCE_MODE,
  BalancerSelection,
  isLoadBalanceMode,
} from './types.js';

import {
  RoundRobinStrategy,
  RandomStrategy,
  FailoverStrategy,
  WeightedStrategy,
} from './strategies.js';

/**
 * LoadBalancer coordinates provider selection using configurable strategies
 */
export class LoadBalancer {
  private strategies: Map<LoadBalanceMode, BalancerStrategy>;
  private currentMode: LoadBalanceMode;
  private config: BalancerConfig;

  /**
   * Create a new LoadBalancer
   * @param mode - Initial load balancing mode (default: ROUND_ROBIN)
   * @param config - Optional configuration overrides
   */
  constructor(
    mode: LoadBalanceMode = DEFAULT_BALANCER_CONFIG.mode,
    config: Partial<BalancerConfig> = {}
  ) {
    this.currentMode = mode;
    this.config = {
      ...DEFAULT_BALANCER_CONFIG,
      ...config,
      mode, // Ensure mode matches constructor param
    };

    // Initialize all strategies
    this.strategies = new Map([
      [LOAD_BALANCE_MODE.ROUND_ROBIN, new RoundRobinStrategy()],
      [LOAD_BALANCE_MODE.RANDOM, new RandomStrategy()],
      [LOAD_BALANCE_MODE.FAILOVER, new FailoverStrategy()],
      [LOAD_BALANCE_MODE.WEIGHTED, new WeightedStrategy()],
    ]);
  }

  /**
   * Select a provider from candidates using current strategy
   * Automatically filters to healthy candidates only
   * @param candidates - All provider candidates
   * @returns Selected candidate or null if none available
   */
  select(candidates: ProviderCandidate[]): ProviderCandidate | null {
    // Filter to healthy candidates only
    const healthy = candidates.filter(c => c.healthy);
    if (healthy.length === 0) return null;

    const strategy = this.strategies.get(this.currentMode);
    if (!strategy) return null;

    return strategy.select(healthy);
  }

  /**
   * Select a provider with full result details
   * @param candidates - All provider candidates
   * @returns Selection result or null if none available
   */
  selectWithDetails(candidates: ProviderCandidate[]): BalancerSelection | null {
    const candidate = this.select(candidates);
    if (!candidate) return null;

    return {
      candidate,
      strategy: this.currentMode,
      timestamp: Date.now(),
    };
  }

  /**
   * Set the load balancing mode
   * Resets stateful strategies when switching
   * @param mode - New load balancing mode
   */
  setMode(mode: LoadBalanceMode): void {
    // Reset current strategy if it has reset method
    const currentStrategy = this.strategies.get(this.currentMode);
    if (currentStrategy?.reset) {
      currentStrategy.reset();
    }

    this.currentMode = mode;
    this.config.mode = mode;

    // Reset new strategy
    const newStrategy = this.strategies.get(mode);
    if (newStrategy?.reset) {
      newStrategy.reset();
    }
  }

  /**
   * Get current load balancing mode
   */
  getMode(): LoadBalanceMode {
    return this.currentMode;
  }

  /**
   * Get current configuration
   */
  getConfig(): BalancerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<BalancerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };

    // If mode changed, handle the switch
    if (config.mode && config.mode !== this.currentMode) {
      this.setMode(config.mode);
    }
  }

  /**
   * Get available load balancing modes
   */
  getAvailableModes(): LoadBalanceMode[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Check if a mode is supported
   * @param mode - Mode to check
   */
  isModeSupported(mode: string): mode is LoadBalanceMode {
    return isLoadBalanceMode(mode) && this.strategies.has(mode);
  }

  /**
   * Reset all strategies (useful for testing)
   */
  reset(): void {
    for (const strategy of this.strategies.values()) {
      if (strategy.reset) {
        strategy.reset();
      }
    }
  }
}

/**
 * Create a LoadBalancer from a mode string (for API/config use)
 * @param modeStr - Mode string to parse
 * @param config - Optional configuration
 * @returns LoadBalancer instance or null if mode invalid
 */
export function createBalancerFromString(
  modeStr: string,
  config: Partial<BalancerConfig> = {}
): LoadBalancer | null {
  if (!isLoadBalanceMode(modeStr)) {
    return null;
  }
  return new LoadBalancer(modeStr, config);
}

/**
 * Get all available load balancing modes as strings
 * Useful for API responses and UI dropdowns
 */
export function getAllLoadBalanceModes(): { mode: LoadBalanceMode; description: string }[] {
  return [
    { mode: LOAD_BALANCE_MODE.ROUND_ROBIN, description: 'Cycles through providers sequentially' },
    { mode: LOAD_BALANCE_MODE.RANDOM, description: 'Randomly selects from available providers' },
    { mode: LOAD_BALANCE_MODE.FAILOVER, description: 'Selects by priority, falls back on failure' },
    { mode: LOAD_BALANCE_MODE.WEIGHTED, description: 'Selects based on configured weight distribution' },
  ];
}
