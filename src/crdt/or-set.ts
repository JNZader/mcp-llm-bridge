/**
 * OR-Set — observed-remove set CRDT.
 *
 * Each add generates a unique tag (nodeId + sequence number).
 * Remove only removes tags that have been observed locally.
 * On merge, an element is present if any tag for it exists
 * in either replica that hasn't been explicitly removed.
 *
 * Properties: commutative, associative, idempotent.
 */

import type { ORSetTag, ORSetState } from './types.js';

export class ORSet {
  /** element → set of live tags */
  private elements: Map<string, ORSetTag[]>;
  /** nodeId → current sequence counter */
  private seqCounters: Map<string, number>;

  constructor() {
    this.elements = new Map();
    this.seqCounters = new Map();
  }

  /** Add an element. Returns the generated tag. */
  add(element: string, nodeId: string): ORSetTag {
    const seq = (this.seqCounters.get(nodeId) ?? 0) + 1;
    this.seqCounters.set(nodeId, seq);

    const tag: ORSetTag = { nodeId, seq };
    const existing = this.elements.get(element) ?? [];
    existing.push(tag);
    this.elements.set(element, existing);

    return tag;
  }

  /** Remove an element by removing all its currently observed tags. */
  remove(element: string): void {
    this.elements.delete(element);
  }

  /** List all elements currently in the set. */
  list(): string[] {
    const result: string[] = [];
    for (const [element, tags] of this.elements.entries()) {
      if (tags.length > 0) {
        result.push(element);
      }
    }
    return result;
  }

  /** Check if an element is in the set. */
  has(element: string): boolean {
    const tags = this.elements.get(element);
    return tags !== undefined && tags.length > 0;
  }

  /** Merge another OR-Set into this one. */
  merge(other: ORSet): void {
    // For each element in other, add any tags we don't have
    for (const [element, otherTags] of other.elements.entries()) {
      const myTags = this.elements.get(element) ?? [];
      for (const otherTag of otherTags) {
        const alreadyHave = myTags.some(
          (t) => t.nodeId === otherTag.nodeId && t.seq === otherTag.seq,
        );
        if (!alreadyHave) {
          myTags.push(otherTag);
        }
      }
      if (myTags.length > 0) {
        this.elements.set(element, myTags);
      }
    }

    // Update sequence counters to max
    for (const [nodeId, seq] of other.seqCounters.entries()) {
      const mySeq = this.seqCounters.get(nodeId) ?? 0;
      this.seqCounters.set(nodeId, Math.max(mySeq, seq));
    }
  }

  /** Serialize to a plain object. */
  serialize(): ORSetState {
    const entries: Record<string, ORSetTag[]> = {};
    for (const [element, tags] of this.elements.entries()) {
      if (tags.length > 0) {
        entries[element] = tags.map((t) => ({ nodeId: t.nodeId, seq: t.seq }));
      }
    }
    return { entries };
  }

  /** Create an ORSet from serialized state. */
  static fromState(state: ORSetState): ORSet {
    const set = new ORSet();
    for (const [element, tags] of Object.entries(state.entries)) {
      set.elements.set(element, [...tags]);
      // Restore seq counters from tags
      for (const tag of tags) {
        const current = set.seqCounters.get(tag.nodeId) ?? 0;
        if (tag.seq > current) {
          set.seqCounters.set(tag.nodeId, tag.seq);
        }
      }
    }
    return set;
  }
}
