/**
 * Rate limiter tests — verify rate limiting behavior.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter } from '../src/server/rate-limit.js';

// ── RateLimiter class tests ──────────────────────────────────

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ max: 100, windowMs: 15 * 60 * 1000 });
  });

  it('allows first request', () => {
    const ip = '192.168.1.1';
    
    // Should not be rate limited on first request
    const isLimited = limiter.isRateLimited(ip);
    assert.equal(isLimited, false);
  });

  it('allows requests under the limit', () => {
    const ip = '192.168.1.2';
    
    // Make several requests
    for (let i = 0; i < 10; i++) {
      limiter.isRateLimited(ip);
    }
    
    // Should not be rate limited yet (default limit is 100 per 15 min)
    const isLimited = limiter.isRateLimited(ip);
    assert.equal(isLimited, false);
  });

  it('returns remaining requests', () => {
    const ip = '192.168.1.3';
    
    // First request - 99 remaining
    limiter.isRateLimited(ip);
    assert.equal(limiter.getRemaining(ip), 99);
    
    // Second request - 98 remaining
    limiter.isRateLimited(ip);
    assert.equal(limiter.getRemaining(ip), 98);
    
    // Third request - 97 remaining
    limiter.isRateLimited(ip);
    assert.equal(limiter.getRemaining(ip), 97);
  });

  it('returns max for unknown IPs', () => {
    const remaining = limiter.getRemaining('unknown-ip');
    assert.equal(remaining, 100);
  });

  it('tracks reset time', () => {
    const ip = '192.168.1.4';
    
    limiter.isRateLimited(ip);
    
    const resetAt = limiter.getResetAt(ip);
    assert.ok(resetAt > Date.now());
    assert.ok(resetAt <= Date.now() + 15 * 60 * 1000); // Within 15 minutes
  });

  it('rate limits after max requests', () => {
    const ip = '192.168.1.5';
    
    // Make requests up to the limit
    for (let i = 0; i < 100; i++) {
      limiter.isRateLimited(ip);
    }
    
    // Next request should be rate limited
    const isLimited = limiter.isRateLimited(ip);
    assert.equal(isLimited, true);
  });

  it('blocks requests when rate limited', () => {
    const ip = '192.168.1.6';
    
    // Exceed the limit
    for (let i = 0; i < 101; i++) {
      limiter.isRateLimited(ip);
    }
    
    // Should be rate limited
    assert.equal(limiter.isRateLimited(ip), true);
    assert.equal(limiter.getRemaining(ip), 0);
  });

  it('different IPs have independent limits', () => {
    const ip1 = '192.168.1.10';
    const ip2 = '192.168.1.11';
    
    // Use up limit for ip1
    for (let i = 0; i < 100; i++) {
      limiter.isRateLimited(ip1);
    }
    
    // ip1 should be rate limited
    assert.equal(limiter.isRateLimited(ip1), true);
    
    // ip2 should still be allowed
    assert.equal(limiter.isRateLimited(ip2), false);
    assert.equal(limiter.getRemaining(ip2), 99);
  });

  it('allows custom max and window', () => {
    const customLimiter = new RateLimiter({ max: 5, windowMs: 1000 });
    const ip = '192.168.1.20';
    
    // Use up limit
    for (let i = 0; i < 5; i++) {
      customLimiter.isRateLimited(ip);
    }
    
    // Should be rate limited
    assert.equal(customLimiter.isRateLimited(ip), true);
    assert.equal(customLimiter.getRemaining(ip), 0);
  });
});
