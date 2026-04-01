/**
 * StateManager tests — write/read, snapshot, mergeSnapshot, list.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { StateManager } from '../../src/crdt/state-manager.js';

describe('StateManager', () => {
  it('read returns null for non-existent key', () => {
    const mgr = new StateManager();
    assert.equal(mgr.read('nope'), null);
  });

  it('write and read g-counter', () => {
    const mgr = new StateManager();
    mgr.write('tokens', 'g-counter', { nodeId: 'a1', amount: 5 });
    const result = mgr.read('tokens');
    assert.equal(result?.type, 'g-counter');
    assert.equal(result?.value, 5);
  });

  it('write and read lww-register', () => {
    const mgr = new StateManager();
    mgr.write('status', 'lww-register', { value: 'active', nodeId: 'a1', timestamp: 100 });
    const result = mgr.read('status');
    assert.equal(result?.type, 'lww-register');
    assert.equal(result?.value, 'active');
  });

  it('write and read or-set', () => {
    const mgr = new StateManager();
    mgr.write('findings', 'or-set', { action: 'add', element: 'bug-1', nodeId: 'a1' });
    const result = mgr.read('findings');
    assert.equal(result?.type, 'or-set');
    assert.deepEqual(result?.value, ['bug-1']);
  });

  it('throws on type mismatch', () => {
    const mgr = new StateManager();
    mgr.write('tokens', 'g-counter', { nodeId: 'a1', amount: 1 });
    assert.throws(
      () => mgr.write('tokens', 'lww-register', { value: 'x', nodeId: 'a1' }),
      /Type mismatch/,
    );
  });

  it('list returns all containers', () => {
    const mgr = new StateManager();
    mgr.write('tokens', 'g-counter', { nodeId: 'a1', amount: 1 });
    mgr.write('status', 'lww-register', { value: 'idle', nodeId: 'a1' });
    const entries = mgr.list();
    assert.equal(entries.length, 2);
    assert.ok(entries.some((e) => e.key === 'tokens' && e.type === 'g-counter'));
    assert.ok(entries.some((e) => e.key === 'status' && e.type === 'lww-register'));
  });

  it('snapshot and mergeSnapshot round-trip', () => {
    const a = new StateManager();
    a.write('tokens', 'g-counter', { nodeId: 'a1', amount: 10 });

    const b = new StateManager();
    b.write('tokens', 'g-counter', { nodeId: 'a2', amount: 7 });
    b.write('status', 'lww-register', { value: 'busy', nodeId: 'a2', timestamp: 200 });

    a.mergeSnapshot(b.snapshot());

    const tokens = a.read('tokens');
    assert.equal(tokens?.type, 'g-counter');
    assert.equal(tokens?.value, 17); // 10 + 7 (different nodes)

    const status = a.read('status');
    assert.equal(status?.type, 'lww-register');
    assert.equal(status?.value, 'busy');
  });

  it('mergeSnapshot throws on type mismatch', () => {
    const a = new StateManager();
    a.write('data', 'g-counter', { nodeId: 'a1', amount: 1 });

    const b = new StateManager();
    b.write('data', 'lww-register', { value: 'x', nodeId: 'a2' });

    assert.throws(() => a.mergeSnapshot(b.snapshot()), /Type mismatch/);
  });

  it('mergeSnapshot with new keys adds them', () => {
    const a = new StateManager();

    const b = new StateManager();
    b.write('findings', 'or-set', { action: 'add', element: 'f1', nodeId: 'a2' });

    a.mergeSnapshot(b.snapshot());
    const result = a.read('findings');
    assert.deepEqual(result?.value, ['f1']);
  });

  it('or-set remove via write', () => {
    const mgr = new StateManager();
    mgr.write('findings', 'or-set', { action: 'add', element: 'x', nodeId: 'a1' });
    mgr.write('findings', 'or-set', { action: 'remove', element: 'x', nodeId: 'a1' });
    const result = mgr.read('findings');
    assert.deepEqual(result?.value, []);
  });

  it('or-set write requires nodeId for add', () => {
    const mgr = new StateManager();
    assert.throws(
      () => mgr.write('findings', 'or-set', { action: 'add', element: 'x' } as never),
      /nodeId required/,
    );
  });
});
