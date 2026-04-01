/**
 * OR-Set CRDT tests — add, remove, concurrent add survives remove, merge.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ORSet } from '../../src/crdt/or-set.js';

describe('ORSet', () => {
  it('starts empty', () => {
    const set = new ORSet();
    assert.deepEqual(set.list(), []);
  });

  it('add and list', () => {
    const set = new ORSet();
    set.add('finding-1', 'agent-1');
    assert.deepEqual(set.list(), ['finding-1']);
  });

  it('has returns true for existing element', () => {
    const set = new ORSet();
    set.add('x', 'agent-1');
    assert.equal(set.has('x'), true);
    assert.equal(set.has('y'), false);
  });

  it('remove removes element', () => {
    const set = new ORSet();
    set.add('finding-1', 'agent-1');
    set.remove('finding-1');
    assert.deepEqual(set.list(), []);
  });

  it('remove of non-existent element is no-op', () => {
    const set = new ORSet();
    set.add('x', 'agent-1');
    set.remove('y');
    assert.deepEqual(set.list(), ['x']);
  });

  it('concurrent add survives remove', () => {
    // Agent-1 adds "x", agent-2 also adds "x" independently
    const a = new ORSet();
    a.add('x', 'agent-1');

    const b = new ORSet();
    b.add('x', 'agent-2');

    // Agent-1 removes "x" locally
    a.remove('x');
    assert.equal(a.has('x'), false);

    // Merge with agent-2's state — agent-2's add should survive
    a.merge(b);
    assert.equal(a.has('x'), true);
  });

  it('merge combines elements from both sets', () => {
    const a = new ORSet();
    a.add('finding-1', 'agent-1');

    const b = new ORSet();
    b.add('finding-2', 'agent-2');

    a.merge(b);
    const list = a.list().sort();
    assert.deepEqual(list, ['finding-1', 'finding-2']);
  });

  it('merge is commutative', () => {
    const a1 = new ORSet();
    a1.add('x', 'agent-1');
    const b1 = new ORSet();
    b1.add('y', 'agent-2');

    const a2 = new ORSet();
    a2.add('x', 'agent-1');
    const b2 = new ORSet();
    b2.add('y', 'agent-2');

    a1.merge(b1);
    b2.merge(a2);

    assert.deepEqual(a1.list().sort(), b2.list().sort());
  });

  it('merge is idempotent', () => {
    const a = new ORSet();
    a.add('x', 'agent-1');

    const b = new ORSet();
    b.add('y', 'agent-2');

    a.merge(b);
    const afterFirst = a.list().sort();
    a.merge(b);
    assert.deepEqual(a.list().sort(), afterFirst);
  });

  it('serializes and deserializes', () => {
    const original = new ORSet();
    original.add('a', 'agent-1');
    original.add('b', 'agent-2');

    const state = original.serialize();
    const restored = ORSet.fromState(state);

    assert.deepEqual(restored.list().sort(), ['a', 'b']);
  });

  it('deserialized set preserves sequence counters', () => {
    const original = new ORSet();
    original.add('a', 'agent-1');
    original.add('b', 'agent-1');

    const state = original.serialize();
    const restored = ORSet.fromState(state);

    // Adding new element should get seq=3 (not restart at 1)
    const tag = restored.add('c', 'agent-1');
    assert.equal(tag.seq, 3);
  });
});
