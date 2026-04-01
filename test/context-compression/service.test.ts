/**
 * CompressorService facade — submit, getCompressed, compressNow, destroy.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CompressorService } from '../../src/context-compression/service.js';

describe('CompressorService', () => {
  let service: CompressorService;

  afterEach(() => {
    if (service) service.destroy();
  });

  it('returns original content when nothing is cached', () => {
    service = new CompressorService({ workerIntervalMs: 60_000 });

    const original = 'This is some original content.';
    assert.equal(service.getCompressed(original), original);
  });

  it('compressNow returns compressed content immediately', () => {
    service = new CompressorService({ workerIntervalMs: 60_000 });

    const input = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
    const result = service.compressNow(input, 'token-budget', { maxChars: 30 });

    assert.ok(result.length <= 30, `Expected <= 30 chars, got ${result.length}`);
  });

  it('compressNow caches the result for getCompressed', () => {
    service = new CompressorService({ workerIntervalMs: 60_000 });

    const input = 'Content to compress now.';
    const compressed = service.compressNow(input, 'token-budget', { maxChars: 10 });

    // getCompressed should return the cached version
    assert.equal(service.getCompressed(input), compressed);
  });

  it('hasCompressed returns false before compression', () => {
    service = new CompressorService({ workerIntervalMs: 60_000 });
    assert.equal(service.hasCompressed('new content'), false);
  });

  it('hasCompressed returns true after compressNow', () => {
    service = new CompressorService({ workerIntervalMs: 60_000 });
    service.compressNow('test content', 'extractive');
    assert.equal(service.hasCompressed('test content'), true);
  });

  it('tracks cache size', () => {
    service = new CompressorService({ workerIntervalMs: 60_000 });
    assert.equal(service.cacheSize, 0);

    service.compressNow('a', 'extractive');
    assert.equal(service.cacheSize, 1);

    service.compressNow('b', 'extractive');
    assert.equal(service.cacheSize, 2);
  });

  it('submit queues content for background processing', () => {
    service = new CompressorService({ workerIntervalMs: 60_000 });

    service.submit('background content');
    assert.equal(service.pendingCount, 1);
  });

  it('uses default strategy from config', () => {
    service = new CompressorService({
      workerIntervalMs: 60_000,
      defaultStrategy: 'token-budget',
      defaultRatio: 0.3,
    });

    // compressNow with no strategy should use default
    const input = 'A'.repeat(100);
    const result = service.compressNow(input);

    // token-budget with ratio 0.3 should produce <= 30 chars
    assert.ok(result.length <= 30, `Expected <= 30 chars with default ratio 0.3, got ${result.length}`);
  });

  it('destroy clears cache and stops worker', () => {
    service = new CompressorService({ workerIntervalMs: 100 });

    service.compressNow('some content', 'extractive');
    assert.equal(service.cacheSize, 1);

    service.destroy();

    assert.equal(service.cacheSize, 0);
    assert.equal(service.pendingCount, 0);
  });

  it('respects maxCacheSize', () => {
    service = new CompressorService({
      workerIntervalMs: 60_000,
      maxCacheSize: 3,
    });

    service.compressNow('content-1', 'extractive');
    service.compressNow('content-2', 'extractive');
    service.compressNow('content-3', 'extractive');
    service.compressNow('content-4', 'extractive');

    assert.equal(service.cacheSize, 3, 'Cache should not exceed maxSize');
  });
});
