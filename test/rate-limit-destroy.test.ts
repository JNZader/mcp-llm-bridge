/**
 * Rate limiter destroy() and lazy factory tests.
 *
 * Verifies resource cleanup and singleton behavior
 * of the default rate limiter instance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter, getDefaultRateLimiter } from '../src/server/rate-limit.js';

// ── destroy() method ────────────────────────────────────────

describe('RateLimiter.destroy()', () => {
  it('clears entries after destroy', () => {
    const limiter = new RateLimiter({ max: 10, windowMs: 60_000 });

    // Add some state
    limiter.isRateLimited('192.168.1.1');
    limiter.isRateLimited('192.168.1.2');

    assert.equal(limiter.getRemaining('192.168.1.1'), 9);

    // Destroy
    limiter.destroy();

    // After destroy, entries are cleared — IP looks like a fresh visitor
    assert.equal(limiter.getRemaining('192.168.1.1'), 10);
    assert.equal(limiter.getRemaining('192.168.1.2'), 10);
  });

  it('can still be used after destroy (new window starts)', () => {
    const limiter = new RateLimiter({ max: 5, windowMs: 60_000 });

    // Use and destroy
    limiter.isRateLimited('10.0.0.1');
    limiter.destroy();

    // Should work again from scratch
    const isLimited = limiter.isRateLimited('10.0.0.1');
    assert.equal(isLimited, false);
    assert.equal(limiter.getRemaining('10.0.0.1'), 4);
  });

  it('does not throw when called multiple times', () => {
    const limiter = new RateLimiter({ max: 5, windowMs: 1000 });

    assert.doesNotThrow(() => {
      limiter.destroy();
      limiter.destroy();
      limiter.destroy();
    });
  });
});

// ── getDefaultRateLimiter() lazy factory ─────────────────────

describe('getDefaultRateLimiter()', () => {
  it('returns a RateLimiter instance', () => {
    const limiter = getDefaultRateLimiter();
    assert.ok(limiter instanceof RateLimiter);
  });

  it('returns the same instance on subsequent calls', () => {
    const a = getDefaultRateLimiter();
    const b = getDefaultRateLimiter();
    assert.equal(a, b, 'Should return the same singleton instance');
  });

  it('returned instance is functional', () => {
    const limiter = getDefaultRateLimiter();
    const isLimited = limiter.isRateLimited('singleton-test-ip');
    assert.equal(isLimited, false);
    assert.equal(limiter.getRemaining('singleton-test-ip'), 99);
  });
});
