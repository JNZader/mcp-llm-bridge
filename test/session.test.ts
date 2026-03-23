/**
 * Session stickiness tests — pin, get, TTL expiry, cleanup.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SessionStore } from '../src/core/session.js';

describe('SessionStore', () => {
  let store: SessionStore;

  afterEach(() => {
    if (store) store.destroy();
  });

  it('returns null for unknown session', () => {
    store = new SessionStore(60_000);
    assert.equal(store.get('client-1', 'gpt-4'), null);
  });

  it('pins and retrieves a session', () => {
    store = new SessionStore(60_000);
    store.pin('client-1', 'gpt-4', 'openai', 'default', 10_000);

    const result = store.get('client-1', 'gpt-4');
    assert.deepEqual(result, { provider: 'openai', keyName: 'default' });
  });

  it('returns null after TTL expiry', async () => {
    store = new SessionStore(60_000);
    store.pin('client-1', 'gpt-4', 'openai', 'default', 50); // 50ms TTL

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(store.get('client-1', 'gpt-4'), null);
  });

  it('tracks different client+model combinations independently', () => {
    store = new SessionStore(60_000);
    store.pin('client-1', 'gpt-4', 'openai', 'key-a', 10_000);
    store.pin('client-1', 'claude-3', 'anthropic', 'key-b', 10_000);
    store.pin('client-2', 'gpt-4', 'google', 'key-c', 10_000);

    assert.deepEqual(store.get('client-1', 'gpt-4'), { provider: 'openai', keyName: 'key-a' });
    assert.deepEqual(store.get('client-1', 'claude-3'), { provider: 'anthropic', keyName: 'key-b' });
    assert.deepEqual(store.get('client-2', 'gpt-4'), { provider: 'google', keyName: 'key-c' });
  });

  it('overwrites existing pin', () => {
    store = new SessionStore(60_000);
    store.pin('client-1', 'gpt-4', 'openai', 'key-a', 10_000);
    store.pin('client-1', 'gpt-4', 'anthropic', 'key-b', 10_000);

    assert.deepEqual(store.get('client-1', 'gpt-4'), { provider: 'anthropic', keyName: 'key-b' });
  });

  it('unpin removes session', () => {
    store = new SessionStore(60_000);
    store.pin('client-1', 'gpt-4', 'openai', 'default', 10_000);
    store.unpin('client-1', 'gpt-4');

    assert.equal(store.get('client-1', 'gpt-4'), null);
  });

  it('sweep removes expired entries', async () => {
    store = new SessionStore(60_000);
    store.pin('client-1', 'gpt-4', 'openai', 'default', 50); // expires in 50ms
    store.pin('client-2', 'gpt-4', 'anthropic', 'default', 10_000); // long-lived

    assert.equal(store.size, 2);

    // Wait for first to expire
    await new Promise((resolve) => setTimeout(resolve, 100));
    store.sweep();

    assert.equal(store.size, 1);
    assert.equal(store.get('client-1', 'gpt-4'), null);
    assert.deepEqual(store.get('client-2', 'gpt-4'), { provider: 'anthropic', keyName: 'default' });
  });

  it('destroy clears all sessions and stops sweep', () => {
    store = new SessionStore(100); // fast sweep
    store.pin('client-1', 'gpt-4', 'openai', 'default', 10_000);
    store.destroy();

    assert.equal(store.size, 0);
  });

  it('size reflects active session count', () => {
    store = new SessionStore(60_000);
    assert.equal(store.size, 0);

    store.pin('a', 'm1', 'p1', 'k1', 10_000);
    assert.equal(store.size, 1);

    store.pin('b', 'm2', 'p2', 'k2', 10_000);
    assert.equal(store.size, 2);

    store.unpin('a', 'm1');
    assert.equal(store.size, 1);
  });
});
