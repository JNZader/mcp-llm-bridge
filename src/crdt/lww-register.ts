/**
 * LWW-Register — last-writer-wins register CRDT.
 *
 * Stores a single value with a timestamp. On merge, the higher
 * timestamp wins. Ties are broken by comparing nodeId strings
 * (lexicographically higher wins).
 *
 * Properties: commutative, associative, idempotent.
 */

import type { LWWRegisterState } from './types.js';

export class LWWRegister {
  private _value: unknown;
  private _timestamp: number;
  private _nodeId: string;

  constructor() {
    this._value = undefined;
    this._timestamp = 0;
    this._nodeId = '';
  }

  /** Set the register value with a timestamp and node identifier. */
  set(value: unknown, timestamp: number, nodeId: string): void {
    if (
      timestamp > this._timestamp ||
      (timestamp === this._timestamp && nodeId > this._nodeId)
    ) {
      this._value = value;
      this._timestamp = timestamp;
      this._nodeId = nodeId;
    }
  }

  /** Get the current register value. */
  get(): unknown {
    return this._value;
  }

  /** Get the current timestamp. */
  get timestamp(): number {
    return this._timestamp;
  }

  /** Get the current node ID. */
  get nodeId(): string {
    return this._nodeId;
  }

  /** Merge another LWW-Register into this one. */
  merge(other: LWWRegister): void {
    this.set(other._value, other._timestamp, other._nodeId);
  }

  /** Serialize to a plain object. */
  serialize(): LWWRegisterState {
    return {
      value: this._value,
      timestamp: this._timestamp,
      nodeId: this._nodeId,
    };
  }

  /** Create a LWWRegister from serialized state. */
  static fromState(state: LWWRegisterState): LWWRegister {
    const register = new LWWRegister();
    register._value = state.value;
    register._timestamp = state.timestamp;
    register._nodeId = state.nodeId;
    return register;
  }
}
