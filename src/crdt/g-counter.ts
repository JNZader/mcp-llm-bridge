/**
 * G-Counter — grow-only counter CRDT.
 *
 * Each node maintains its own counter. The total value is the sum
 * of all node counters. Merge takes the max of each node's count.
 *
 * Properties: commutative, associative, idempotent.
 */

import type { GCounterState } from './types.js';

export class GCounter {
  private counts: Map<string, number>;

  constructor() {
    this.counts = new Map();
  }

  /** Increment this node's counter by the given amount (default 1). */
  increment(nodeId: string, amount = 1): void {
    if (amount < 0) {
      throw new Error('G-Counter only supports non-negative increments');
    }
    const current = this.counts.get(nodeId) ?? 0;
    this.counts.set(nodeId, current + amount);
  }

  /** Get the total value across all nodes. */
  value(): number {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }

  /** Get the value for a specific node. */
  nodeValue(nodeId: string): number {
    return this.counts.get(nodeId) ?? 0;
  }

  /** Merge another G-Counter into this one (max per node). */
  merge(other: GCounter): void {
    for (const [nodeId, otherCount] of other.counts.entries()) {
      const myCount = this.counts.get(nodeId) ?? 0;
      this.counts.set(nodeId, Math.max(myCount, otherCount));
    }
  }

  /** Serialize to a plain object. */
  serialize(): GCounterState {
    const counts: Record<string, number> = {};
    for (const [nodeId, count] of this.counts.entries()) {
      counts[nodeId] = count;
    }
    return { counts };
  }

  /** Create a GCounter from serialized state. */
  static fromState(state: GCounterState): GCounter {
    const counter = new GCounter();
    for (const [nodeId, count] of Object.entries(state.counts)) {
      counter.counts.set(nodeId, count);
    }
    return counter;
  }
}
