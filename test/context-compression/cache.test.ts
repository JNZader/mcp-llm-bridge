/**
 * LRU compression cache — hit, miss, eviction, content hashing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LRUCompressionCache, contentHash } from '../../src/context-compression/cache.js';

describe('contentHash', () => {
  it('produces a string starting with cc_', () => {
    const hash = contentHash('hello world');
    assert.ok(hash.startsWith('cc_'), `Expected cc_ prefix, got: ${hash}`);
  });

  it('produces same hash for same input', () => {
    assert.equal(contentHash('test'), contentHash('test'));
  });

  it('produces different hash for different input', () => {
    assert.notEqual(contentHash('test-a'), contentHash('test-b'));
  });
});

describe('LRUCompressionCache', () => {
  it('returns null on cache miss', () => {
    const cache = new LRUCompressionCache(10);
    assert.equal(cache.get('nonexistent'), null);
  });

  it('stores and retrieves a compressed result', () => {
    const cache = new LRUCompressionCache(10);
    cache.set('original content', 'compressed', 'extractive');
    assert.equal(cache.get('original content'), 'compressed');
  });

  it('tracks size correctly', () => {
    const cache = new LRUCompressionCache(10);
    assert.equal(cache.size, 0);

    cache.set('a', 'ca', 'extractive');
    assert.equal(cache.size, 1);

    cache.set('b', 'cb', 'extractive');
    assert.equal(cache.size, 2);
  });

  it('evicts LRU entry when at max size', () => {
    const cache = new LRUCompressionCache(3);

    cache.set('entry-1', 'c1', 'extractive');
    cache.set('entry-2', 'c2', 'extractive');
    cache.set('entry-3', 'c3', 'extractive');

    assert.equal(cache.size, 3);

    // This should evict entry-1 (oldest)
    cache.set('entry-4', 'c4', 'extractive');

    assert.equal(cache.size, 3);
    assert.equal(cache.get('entry-1'), null, 'LRU entry should be evicted');
    assert.equal(cache.get('entry-4'), 'c4', 'New entry should be present');
  });

  it('promotes entry on access (LRU behavior)', () => {
    const cache = new LRUCompressionCache(3);

    cache.set('entry-1', 'c1', 'extractive');
    cache.set('entry-2', 'c2', 'extractive');
    cache.set('entry-3', 'c3', 'extractive');

    // Access entry-1, making it most-recently-used
    cache.get('entry-1');

    // Add new entry — should evict entry-2 (now the LRU), not entry-1
    cache.set('entry-4', 'c4', 'extractive');

    assert.equal(cache.get('entry-1'), 'c1', 'Promoted entry should survive');
    assert.equal(cache.get('entry-2'), null, 'LRU entry should be evicted');
  });

  it('updates existing entry without increasing size', () => {
    const cache = new LRUCompressionCache(10);

    cache.set('content', 'old-compressed', 'extractive');
    assert.equal(cache.size, 1);

    cache.set('content', 'new-compressed', 'structural');
    assert.equal(cache.size, 1);
    assert.equal(cache.get('content'), 'new-compressed');
  });

  it('has() returns correct boolean', () => {
    const cache = new LRUCompressionCache(10);

    assert.equal(cache.has('missing'), false);

    cache.set('present', 'compressed', 'extractive');
    assert.equal(cache.has('present'), true);
  });

  it('clear() removes all entries', () => {
    const cache = new LRUCompressionCache(10);
    cache.set('a', 'ca', 'extractive');
    cache.set('b', 'cb', 'extractive');

    cache.clear();

    assert.equal(cache.size, 0);
    assert.equal(cache.get('a'), null);
  });
});
