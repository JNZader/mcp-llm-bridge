/**
 * Load Balancing Strategy Implementations
 *
 * Feature 7: 4 Load Balancing Modes
 * - Round Robin: Cycles through candidates sequentially
 * - Random: Randomly selects from candidates
 * - Failover: Selects by priority, falls back on failure
 * - Weighted: Selects based on weight distribution
 */

import {
  ProviderCandidate,
  BalancerStrategy,
  LoadBalanceMode,
  LOAD_BALANCE_MODE,
} from './types.js';

/**
 * Round Robin Strategy
 * Cycles through candidates in order, wrapping around to the start
 */
export class RoundRobinStrategy implements BalancerStrategy {
  private counter = 0;

  select(candidates: ProviderCandidate[]): ProviderCandidate | null {
    if (candidates.length === 0) return null;

    const selected = candidates[this.counter % candidates.length];
    this.counter++;
    return selected ?? null;
  }

  reset(): void {
    this.counter = 0;
  }
}

/**
 * Random Strategy
 * Randomly selects from available candidates
 */
export class RandomStrategy implements BalancerStrategy {
  select(candidates: ProviderCandidate[]): ProviderCandidate | null {
    if (candidates.length === 0) return null;

    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index] ?? null;
  }
}

/**
 * Failover Strategy
 * Selects candidate with lowest priority number (highest priority)
 * Skips unhealthy candidates
 */
export class FailoverStrategy implements BalancerStrategy {
  select(candidates: ProviderCandidate[]): ProviderCandidate | null {
    if (candidates.length === 0) return null;

    // Sort by priority (ascending), undefined priorities get 999 (lowest)
    const sorted = [...candidates].sort((a, b) => {
      const priorityA = a.priority ?? 999;
      const priorityB = b.priority ?? 999;
      return priorityA - priorityB;
    });

    // Return first healthy candidate
    return sorted.find(c => c.healthy) || null;
  }
}

/**
 * Weighted Strategy
 * Selects candidates based on weighted random distribution
 * Higher weight = higher chance of selection
 */
export class WeightedStrategy implements BalancerStrategy {
  select(candidates: ProviderCandidate[]): ProviderCandidate | null {
    if (candidates.length === 0) return null;

    // Calculate total weight (default weight is 1)
    const totalWeight = candidates.reduce(
      (sum, c) => sum + (c.weight ?? 1),
      0
    );

    // Weighted random selection
    let random = Math.random() * totalWeight;

    for (const candidate of candidates) {
      random -= (candidate.weight ?? 1);
      if (random <= 0) return candidate;
    }

    // Fallback to last candidate (should rarely happen due to floating point)
    return candidates[candidates.length - 1] ?? null;
  }
}

/**
 * Factory to create strategy instances by mode
 */
export function createStrategy(mode: LoadBalanceMode): BalancerStrategy {
  switch (mode) {
    case LOAD_BALANCE_MODE.ROUND_ROBIN:
      return new RoundRobinStrategy();
    case LOAD_BALANCE_MODE.RANDOM:
      return new RandomStrategy();
    case LOAD_BALANCE_MODE.FAILOVER:
      return new FailoverStrategy();
    case LOAD_BALANCE_MODE.WEIGHTED:
      return new WeightedStrategy();
    default:
      throw new Error(`Unknown load balance mode: ${mode}`);
  }
}

/**
 * Get human-readable description of a strategy
 */
export function getStrategyDescription(mode: LoadBalanceMode): string {
  switch (mode) {
    case LOAD_BALANCE_MODE.ROUND_ROBIN:
      return 'Cycles through providers sequentially';
    case LOAD_BALANCE_MODE.RANDOM:
      return 'Randomly selects from available providers';
    case LOAD_BALANCE_MODE.FAILOVER:
      return 'Selects by priority, falls back to next on failure';
    case LOAD_BALANCE_MODE.WEIGHTED:
      return 'Selects based on configured weight distribution';
    default:
      return 'Unknown strategy';
  }
}
