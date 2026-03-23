/**
 * Load Balancer — strategy-based provider selection.
 *
 * Each ProviderGroup owns a Balancer instance that determines
 * which member to try next. Strategies:
 *
 * - RoundRobin:  cycles sequentially through members
 * - Random:      uniform random selection
 * - Failover:    always picks the first available (priority order)
 * - Weighted:    weighted random based on configured weights
 *
 * All balancers respect an `excluded` set to skip members whose
 * circuit breakers are open.
 */

import type { GroupMember } from './groups.js';

// ── Balancer Interface ─────────────────────────────────────

export type BalancerStrategy = 'round-robin' | 'random' | 'failover' | 'weighted';

export interface Balancer {
  readonly strategy: BalancerStrategy;
  /**
   * Select the next member from candidates, skipping any in `excluded`.
   * Returns null if no candidate is available.
   */
  next(members: GroupMember[], excluded?: Set<string>): GroupMember | null;
  /** Reset internal state (counters, etc). */
  reset(): void;
}

// ── Helpers ────────────────────────────────────────────────

/** Build a unique key for a member (provider:keyName). */
export function memberKey(m: GroupMember): string {
  return `${m.provider}:${m.keyName ?? 'default'}`;
}

/** Filter out excluded members. */
function available(members: GroupMember[], excluded?: Set<string>): GroupMember[] {
  if (!excluded || excluded.size === 0) return members;
  return members.filter((m) => !excluded.has(memberKey(m)));
}

// ── RoundRobinBalancer ─────────────────────────────────────

export class RoundRobinBalancer implements Balancer {
  readonly strategy: BalancerStrategy = 'round-robin';
  private index = 0;

  next(members: GroupMember[], excluded?: Set<string>): GroupMember | null {
    const pool = available(members, excluded);
    if (pool.length === 0) return null;

    const member = pool[this.index % pool.length]!;
    this.index = (this.index + 1) % pool.length;
    return member;
  }

  reset(): void {
    this.index = 0;
  }
}

// ── RandomBalancer ─────────────────────────────────────────

export class RandomBalancer implements Balancer {
  readonly strategy: BalancerStrategy = 'random';

  next(members: GroupMember[], excluded?: Set<string>): GroupMember | null {
    const pool = available(members, excluded);
    if (pool.length === 0) return null;

    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx]!;
  }

  reset(): void {
    // Stateless — nothing to reset.
  }
}

// ── FailoverBalancer ───────────────────────────────────────

/**
 * Always picks the first available member in order.
 * Members are assumed to be in priority order (first = highest priority).
 * If `priority` field is set, sorts by it ascending (lower = higher priority).
 */
export class FailoverBalancer implements Balancer {
  readonly strategy: BalancerStrategy = 'failover';

  next(members: GroupMember[], excluded?: Set<string>): GroupMember | null {
    const pool = available(members, excluded);
    if (pool.length === 0) return null;

    // Sort by priority if any members have it set (lower = higher priority)
    const sorted = [...pool].sort((a, b) => {
      const pa = a.priority ?? Infinity;
      const pb = b.priority ?? Infinity;
      return pa - pb;
    });

    return sorted[0]!;
  }

  reset(): void {
    // Stateless — nothing to reset.
  }
}

// ── WeightedBalancer ───────────────────────────────────────

/**
 * Weighted random selection. Each member's `weight` determines
 * its probability of being selected. Default weight is 1.
 */
export class WeightedBalancer implements Balancer {
  readonly strategy: BalancerStrategy = 'weighted';

  next(members: GroupMember[], excluded?: Set<string>): GroupMember | null {
    const pool = available(members, excluded);
    if (pool.length === 0) return null;

    const totalWeight = pool.reduce((sum, m) => sum + (m.weight ?? 1), 0);
    let random = Math.random() * totalWeight;

    for (const member of pool) {
      random -= member.weight ?? 1;
      if (random <= 0) return member;
    }

    // Fallback (shouldn't happen due to floating point)
    return pool[pool.length - 1]!;
  }

  reset(): void {
    // Stateless — nothing to reset.
  }
}

// ── Factory ────────────────────────────────────────────────

/** Create a Balancer instance for the given strategy. */
export function createBalancer(strategy: BalancerStrategy): Balancer {
  switch (strategy) {
    case 'round-robin':
      return new RoundRobinBalancer();
    case 'random':
      return new RandomBalancer();
    case 'failover':
      return new FailoverBalancer();
    case 'weighted':
      return new WeightedBalancer();
  }
}
