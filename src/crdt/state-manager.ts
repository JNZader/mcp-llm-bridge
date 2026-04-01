/**
 * StateManager — coordinates named CRDT containers.
 *
 * Each container is identified by a string key and holds one CRDT
 * instance. The manager supports write, read, snapshot, and merge
 * operations across all containers.
 */

import type {
  CRDTType,
  CRDTValue,
  StateSnapshot,
  GCounterState,
  LWWRegisterState,
  ORSetState,
} from './types.js';
import { GCounter } from './g-counter.js';
import { LWWRegister } from './lww-register.js';
import { ORSet } from './or-set.js';

/** Union of all CRDT instances managed by StateManager. */
type CRDTInstance = GCounter | LWWRegister | ORSet;

/** Write operation arguments per CRDT type. */
export interface WriteArgs {
  'g-counter': { nodeId: string; amount?: number };
  'lww-register': { value: unknown; timestamp?: number; nodeId: string };
  'or-set': { action: 'add' | 'remove'; element: string; nodeId?: string };
}

export class StateManager {
  private containers: Map<string, { type: CRDTType; instance: CRDTInstance }>;

  constructor() {
    this.containers = new Map();
  }

  /** Write to a named container, creating it if needed. */
  write<T extends CRDTType>(
    key: string,
    type: T,
    args: WriteArgs[T],
  ): void {
    let entry = this.containers.get(key);

    if (!entry) {
      entry = { type, instance: this.createInstance(type) };
      this.containers.set(key, entry);
    }

    if (entry.type !== type) {
      throw new Error(
        `Type mismatch for key "${key}": existing=${entry.type}, requested=${type}`,
      );
    }

    this.applyWrite(entry.instance, type, args);
  }

  /** Read the current value from a named container. */
  read(key: string): { type: CRDTType; value: unknown } | null {
    const entry = this.containers.get(key);
    if (!entry) return null;

    return {
      type: entry.type,
      value: this.readValue(entry.instance, entry.type),
    };
  }

  /** List all container keys with their types. */
  list(): Array<{ key: string; type: CRDTType }> {
    return Array.from(this.containers.entries()).map(([key, entry]) => ({
      key,
      type: entry.type,
    }));
  }

  /** Create a snapshot of all containers. */
  snapshot(): StateSnapshot {
    const entries: Record<string, CRDTValue> = {};
    for (const [key, entry] of this.containers.entries()) {
      entries[key] = {
        type: entry.type,
        state: this.serializeInstance(entry.instance, entry.type),
      };
    }
    return { entries };
  }

  /** Merge an incoming snapshot into this manager's state. */
  mergeSnapshot(incoming: StateSnapshot): void {
    for (const [key, value] of Object.entries(incoming.entries)) {
      const existing = this.containers.get(key);
      const incomingInstance = this.deserializeInstance(value.type, value.state);

      if (!existing) {
        this.containers.set(key, { type: value.type, instance: incomingInstance });
        continue;
      }

      if (existing.type !== value.type) {
        throw new Error(
          `Type mismatch on merge for key "${key}": local=${existing.type}, remote=${value.type}`,
        );
      }

      this.mergeInstances(existing.instance, incomingInstance, existing.type);
    }
  }

  // ── Private helpers ──

  private createInstance(type: CRDTType): CRDTInstance {
    switch (type) {
      case 'g-counter':
        return new GCounter();
      case 'lww-register':
        return new LWWRegister();
      case 'or-set':
        return new ORSet();
    }
  }

  private applyWrite(
    instance: CRDTInstance,
    type: CRDTType,
    args: WriteArgs[CRDTType],
  ): void {
    switch (type) {
      case 'g-counter': {
        const a = args as WriteArgs['g-counter'];
        (instance as GCounter).increment(a.nodeId, a.amount ?? 1);
        break;
      }
      case 'lww-register': {
        const a = args as WriteArgs['lww-register'];
        (instance as LWWRegister).set(
          a.value,
          a.timestamp ?? Date.now(),
          a.nodeId,
        );
        break;
      }
      case 'or-set': {
        const a = args as WriteArgs['or-set'];
        if (a.action === 'add') {
          if (!a.nodeId) throw new Error('nodeId required for or-set add');
          (instance as ORSet).add(a.element, a.nodeId);
        } else {
          (instance as ORSet).remove(a.element);
        }
        break;
      }
    }
  }

  private readValue(instance: CRDTInstance, type: CRDTType): unknown {
    switch (type) {
      case 'g-counter':
        return (instance as GCounter).value();
      case 'lww-register':
        return (instance as LWWRegister).get();
      case 'or-set':
        return (instance as ORSet).list();
    }
  }

  private serializeInstance(
    instance: CRDTInstance,
    type: CRDTType,
  ): GCounterState | LWWRegisterState | ORSetState {
    switch (type) {
      case 'g-counter':
        return (instance as GCounter).serialize();
      case 'lww-register':
        return (instance as LWWRegister).serialize();
      case 'or-set':
        return (instance as ORSet).serialize();
    }
  }

  private deserializeInstance(
    type: CRDTType,
    state: GCounterState | LWWRegisterState | ORSetState,
  ): CRDTInstance {
    switch (type) {
      case 'g-counter':
        return GCounter.fromState(state as GCounterState);
      case 'lww-register':
        return LWWRegister.fromState(state as LWWRegisterState);
      case 'or-set':
        return ORSet.fromState(state as ORSetState);
    }
  }

  private mergeInstances(
    local: CRDTInstance,
    remote: CRDTInstance,
    type: CRDTType,
  ): void {
    switch (type) {
      case 'g-counter':
        (local as GCounter).merge(remote as GCounter);
        break;
      case 'lww-register':
        (local as LWWRegister).merge(remote as LWWRegister);
        break;
      case 'or-set':
        (local as ORSet).merge(remote as ORSet);
        break;
    }
  }
}
