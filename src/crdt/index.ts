/**
 * CRDT Module — conflict-free replicated data types for multi-agent state.
 *
 * Provides three CRDT types (G-Counter, LWW-Register, OR-Set) and a
 * StateManager that coordinates named containers with snapshot/merge.
 */

// Core classes
export { GCounter } from './g-counter.js';
export { LWWRegister } from './lww-register.js';
export { ORSet } from './or-set.js';
export { StateManager } from './state-manager.js';

// Types
export type {
  CRDTType,
  GCounterState,
  LWWRegisterState,
  ORSetTag,
  ORSetState,
  CRDTValue,
  StateSnapshot,
  StateOperation,
} from './types.js';

export type { WriteArgs } from './state-manager.js';
