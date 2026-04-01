/**
 * G-Counter CRDT tests — increment, merge, commutativity, idempotency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GCounter } from '../../src/crdt/g-counter.js';

describe('GCounter', () => {
  it('starts at zero', () => {
    const counter = new GCounter();
    assert.equal(counter.value(), 0);
  });

  it('increments by default amount (1)', () => {
    const counter = new GCounter();
    counter.increment('agent-1');
    assert.equal(counter.value(), 1);
  });

  it('increments by specified amount', () => {
    const counter = new GCounter();
    counter.increment('agent-1', 5);
    assert.equal(counter.value(), 5);
  });

  it('tracks per-node values', () => {
    const counter = new GCounter();
    counter.increment('agent-1', 3);
    counter.increment('agent-2', 7);
    assert.equal(counter.nodeValue('agent-1'), 3);
    assert.equal(counter.nodeValue('agent-2'), 7);
    assert.equal(counter.value(), 10);
  });

  it('rejects negative increments', () => {
    const counter = new GCounter();
    assert.throws(() => counter.increment('agent-1', -1), /non-negative/);
  });

  it('merges two counters (max per node)', () => {
    const a = new GCounter();
    a.increment('agent-1', 3);

    const b = new GCounter();
    b.increment('agent-2', 7);

    a.merge(b);
    assert.equal(a.value(), 10);
    assert.equal(a.nodeValue('agent-1'), 3);
    assert.equal(a.nodeValue('agent-2'), 7);
  });

  it('merge takes max when same node exists in both', () => {
    const a = new GCounter();
    a.increment('agent-1', 5);

    const b = new GCounter();
    b.increment('agent-1', 3);

    a.merge(b);
    assert.equal(a.value(), 5); // max(5, 3)
  });

  it('merge is commutative (a.merge(b) == b.merge(a))', () => {
    const a1 = new GCounter();
    a1.increment('agent-1', 3);
    const b1 = new GCounter();
    b1.increment('agent-2', 7);

    const a2 = new GCounter();
    a2.increment('agent-1', 3);
    const b2 = new GCounter();
    b2.increment('agent-2', 7);

    a1.merge(b1);
    b2.merge(a2);

    assert.equal(a1.value(), b2.value());
  });

  it('merge is idempotent (a.merge(b); a.merge(b) → same result)', () => {
    const a = new GCounter();
    a.increment('agent-1', 3);

    const b = new GCounter();
    b.increment('agent-2', 7);

    a.merge(b);
    const valueAfterFirst = a.value();
    a.merge(b);
    assert.equal(a.value(), valueAfterFirst);
  });

  it('serializes and deserializes', () => {
    const original = new GCounter();
    original.increment('agent-1', 3);
    original.increment('agent-2', 7);

    const state = original.serialize();
    const restored = GCounter.fromState(state);

    assert.equal(restored.value(), 10);
    assert.equal(restored.nodeValue('agent-1'), 3);
    assert.equal(restored.nodeValue('agent-2'), 7);
  });
});
