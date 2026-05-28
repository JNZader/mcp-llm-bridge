/**
 * Unit tests for embedding cache skeleton.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEmbeddingCache } from '../../src/code-search/cache.js';

describe('InMemoryEmbeddingCache', () => {
  it('stores and retrieves embeddings by hash', async () => {
    const cache = new InMemoryEmbeddingCache();
    const vector = new Float32Array([1, 2, 3]);
    await cache.set('hash1', vector);
    const result = await cache.get('hash1');
    assert.ok(result);
    assert.deepEqual(Array.from(result!), [1, 2, 3]);
  });

  it('returns null for missing hash', async () => {
    const cache = new InMemoryEmbeddingCache();
    const result = await cache.get('nonexistent');
    assert.equal(result, null);
  });

  it('uses unique keys for different hashes', async () => {
    const cache = new InMemoryEmbeddingCache();
    const v1 = new Float32Array([10, 20, 30]);
    const v2 = new Float32Array([40, 50, 60]);
    await cache.set('a', v1);
    await cache.set('b', v2);
    const r1 = await cache.get('a');
    const r2 = await cache.get('b');
    assert.deepEqual(Array.from(r1!), [10, 20, 30]);
    assert.deepEqual(Array.from(r2!), [40, 50, 60]);
  });

  it('returns a copy of stored vector (immutable)', async () => {
    const cache = new InMemoryEmbeddingCache();
    const vector = new Float32Array([100, 200, 300]);
    await cache.set('hash1', vector);
    const result = await cache.get('hash1');
    result![0] = 999;
    const result2 = await cache.get('hash1');
    assert.equal(result2![0], 100);
  });
});
