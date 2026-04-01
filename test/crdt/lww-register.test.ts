/**
 * LWW-Register CRDT tests — set/get, timestamp wins, nodeId tiebreaker.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LWWRegister } from '../../src/crdt/lww-register.js';

describe('LWWRegister', () => {
  it('starts as undefined', () => {
    const reg = new LWWRegister();
    assert.equal(reg.get(), undefined);
  });

  it('set and get', () => {
    const reg = new LWWRegister();
    reg.set('active', 100, 'agent-1');
    assert.equal(reg.get(), 'active');
  });

  it('later timestamp wins', () => {
    const reg = new LWWRegister();
    reg.set('idle', 100, 'agent-1');
    reg.set('active', 200, 'agent-2');
    assert.equal(reg.get(), 'active');
  });

  it('earlier timestamp is ignored', () => {
    const reg = new LWWRegister();
    reg.set('active', 200, 'agent-1');
    reg.set('idle', 100, 'agent-2');
    assert.equal(reg.get(), 'active');
  });

  it('same timestamp uses nodeId tiebreaker (higher wins)', () => {
    const reg = new LWWRegister();
    reg.set('a', 100, 'agent-1');
    reg.set('b', 100, 'agent-2');
    assert.equal(reg.get(), 'b'); // "agent-2" > "agent-1"
  });

  it('merge with later timestamp wins', () => {
    const a = new LWWRegister();
    a.set('idle', 100, 'agent-1');

    const b = new LWWRegister();
    b.set('active', 200, 'agent-2');

    a.merge(b);
    assert.equal(a.get(), 'active');
  });

  it('merge is commutative', () => {
    const a1 = new LWWRegister();
    a1.set('idle', 100, 'agent-1');
    const b1 = new LWWRegister();
    b1.set('active', 200, 'agent-2');

    const a2 = new LWWRegister();
    a2.set('idle', 100, 'agent-1');
    const b2 = new LWWRegister();
    b2.set('active', 200, 'agent-2');

    a1.merge(b1);
    b2.merge(a2);

    assert.equal(a1.get(), b2.get());
  });

  it('merge is idempotent', () => {
    const a = new LWWRegister();
    a.set('idle', 100, 'agent-1');

    const b = new LWWRegister();
    b.set('active', 200, 'agent-2');

    a.merge(b);
    const afterFirst = a.get();
    a.merge(b);
    assert.equal(a.get(), afterFirst);
  });

  it('serializes and deserializes', () => {
    const original = new LWWRegister();
    original.set('running', 500, 'agent-3');

    const state = original.serialize();
    const restored = LWWRegister.fromState(state);

    assert.equal(restored.get(), 'running');
    assert.equal(restored.timestamp, 500);
    assert.equal(restored.nodeId, 'agent-3');
  });

  it('supports complex values', () => {
    const reg = new LWWRegister();
    reg.set({ task: 'indexing', progress: 42 }, 100, 'agent-1');
    assert.deepEqual(reg.get(), { task: 'indexing', progress: 42 });
  });
});
