/**
 * Background compression worker — queue processing, dedup, destroy.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { BackgroundCompressionWorker } from '../../src/context-compression/worker.js';
import { LRUCompressionCache } from '../../src/context-compression/cache.js';

describe('BackgroundCompressionWorker', () => {
  let worker: BackgroundCompressionWorker;
  let cache: LRUCompressionCache;

  afterEach(() => {
    if (worker) worker.destroy();
  });

  it('processes submitted items on processQueue()', () => {
    cache = new LRUCompressionCache(100);
    worker = new BackgroundCompressionWorker(cache, 60_000);

    worker.submit('Hello world. This is a test sentence.', 'extractive');
    assert.equal(worker.pendingCount, 1);

    worker.processQueue();

    assert.equal(worker.pendingCount, 0);
    assert.ok(cache.has('Hello world. This is a test sentence.'), 'Content should be cached after processing');
  });

  it('skips content that is already cached', () => {
    cache = new LRUCompressionCache(100);
    cache.set('already cached', 'compressed-version', 'extractive');

    worker = new BackgroundCompressionWorker(cache, 60_000);
    worker.submit('already cached', 'extractive');

    // Should not be queued since it's already cached
    assert.equal(worker.pendingCount, 0);
  });

  it('deduplicates queue entries', () => {
    cache = new LRUCompressionCache(100);
    worker = new BackgroundCompressionWorker(cache, 60_000);

    worker.submit('duplicate content', 'extractive');
    worker.submit('duplicate content', 'extractive');

    assert.equal(worker.pendingCount, 1, 'Should deduplicate identical content');
  });

  it('processes multiple items', () => {
    cache = new LRUCompressionCache(100);
    worker = new BackgroundCompressionWorker(cache, 60_000);

    worker.submit('First content to compress.', 'extractive');
    worker.submit('Second content to compress.', 'token-budget', { maxChars: 10 });

    assert.equal(worker.pendingCount, 2);

    worker.processQueue();

    assert.equal(worker.pendingCount, 0);
    assert.ok(cache.has('First content to compress.'));
    assert.ok(cache.has('Second content to compress.'));
  });

  it('handles invalid strategy gracefully', () => {
    cache = new LRUCompressionCache(100);
    worker = new BackgroundCompressionWorker(cache, 60_000);

    // Force an item with a bad strategy into the queue
    worker.submit('test content', 'nonexistent-strategy');
    assert.equal(worker.pendingCount, 1);

    // Should not throw — just skip the bad item
    worker.processQueue();

    assert.equal(worker.pendingCount, 0);
    assert.ok(!cache.has('test content'), 'Failed compression should not be cached');
  });

  it('destroy clears queue and stops timer', () => {
    cache = new LRUCompressionCache(100);
    worker = new BackgroundCompressionWorker(cache, 100);
    worker.start();

    worker.submit('pending item', 'extractive');
    assert.equal(worker.pendingCount, 1);

    worker.destroy();

    assert.equal(worker.pendingCount, 0, 'Queue should be cleared on destroy');
  });

  it('start is idempotent', () => {
    cache = new LRUCompressionCache(100);
    worker = new BackgroundCompressionWorker(cache, 60_000);

    // Calling start multiple times should not throw or create multiple timers
    worker.start();
    worker.start();
    worker.start();

    worker.destroy();
  });
});
