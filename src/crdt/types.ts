/**
 * CRDT type definitions for multi-agent state merging.
 *
 * Supports three conflict-free replicated data types:
 * - G-Counter: grow-only counter (token tracking)
 * - LWW-Register: last-writer-wins register (agent status)
 * - OR-Set: observed-remove set (shared findings)
 */

/** Supported CRDT type identifiers. */
export type CRDTType = 'g-counter' | 'lww-register' | 'or-set';

/** Serialized G-Counter state: node ID → count. */
export interface GCounterState {
  counts: Record<string, number>;
}

/** Serialized LWW-Register state. */
export interface LWWRegisterState {
  value: unknown;
  timestamp: number;
  nodeId: string;
}

/** A unique tag identifying a specific add operation in an OR-Set. */
export interface ORSetTag {
  nodeId: string;
  seq: number;
}

/** Serialized OR-Set state. */
export interface ORSetState {
  /** element serialized as string → array of tags that added it */
  entries: Record<string, ORSetTag[]>;
}

/** A serialized CRDT value with its type discriminator. */
export interface CRDTValue {
  type: CRDTType;
  state: GCounterState | LWWRegisterState | ORSetState;
}

/** A full state snapshot containing all named CRDT containers. */
export interface StateSnapshot {
  entries: Record<string, CRDTValue>;
}

/** Operations supported by the shared_state MCP tool. */
export type StateOperation = 'read' | 'write' | 'merge' | 'snapshot' | 'list';
