/**
 * Circuit breaker tests — state transitions, thresholds, and registry.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitBreakerOpenError,
  CircuitState,
  withCircuitBreaker,
  buildBreakerKey,
} from '../src/core/circuit-breaker.js';

// ── CircuitBreaker core ──────────────────────────────────────

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenSuccessThreshold: 2,
    });
  });

  it('starts in CLOSED state', () => {
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.canRequest(), true);
  });

  it('getName() returns provider name', () => {
    assert.equal(breaker.getName(), 'test-provider');
  });

  it('stays CLOSED below failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();

    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.canRequest(), true);
  });

  it('opens after reaching failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    assert.equal(breaker.getState(), CircuitState.OPEN);
    assert.equal(breaker.canRequest(), false);
  });

  it('resets failure count on success in CLOSED state', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    // Two more failures should NOT open because count was reset
    breaker.recordFailure();
    breaker.recordFailure();

    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });

  it('transitions to HALF_OPEN after timeout elapses', async () => {
    // Open the breaker
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.getState(), CircuitState.OPEN);

    // Wait for the reset timeout (100ms)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // canRequest() should transition to HALF_OPEN and return true
    assert.equal(breaker.canRequest(), true);
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);
  });

  it('closes on enough successes in HALF_OPEN state', async () => {
    // Open → wait → HALF_OPEN
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 150));
    breaker.canRequest(); // triggers HALF_OPEN

    // Need 2 successes (halfOpenSuccessThreshold)
    breaker.recordSuccess();
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    breaker.recordSuccess();
    assert.equal(breaker.getState(), CircuitState.CLOSED);
  });

  it('re-opens immediately on failure in HALF_OPEN state', async () => {
    // Open → wait → HALF_OPEN
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 150));
    breaker.canRequest(); // triggers HALF_OPEN

    breaker.recordFailure();
    assert.equal(breaker.getState(), CircuitState.OPEN);
  });

  it('getStats() returns current state and failure count', () => {
    breaker.recordFailure();
    breaker.recordFailure();

    const stats = breaker.getStats();
    assert.equal(stats.name, 'test-provider');
    assert.equal(stats.state, CircuitState.CLOSED);
    assert.equal(stats.failures, 2);
  });

  it('forceState() changes state and resets counters when CLOSED', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.getState(), CircuitState.OPEN);

    breaker.forceState(CircuitState.CLOSED);

    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.getStats().failures, 0);
  });

  it('forceState(OPEN) sets state without resetting counters', () => {
    breaker.recordFailure();
    breaker.forceState(CircuitState.OPEN);

    assert.equal(breaker.getState(), CircuitState.OPEN);
    assert.equal(breaker.getStats().failures, 1);
  });
});

// ── CircuitBreakerRegistry ──────────────────────────────────

describe('CircuitBreakerRegistry', () => {
  it('creates breakers on demand', () => {
    const registry = new CircuitBreakerRegistry();
    const breaker = registry.get('provider-a');

    assert.ok(breaker instanceof CircuitBreaker);
    assert.equal(breaker.getName(), 'provider-a');
  });

  it('returns the same breaker for the same provider', () => {
    const registry = new CircuitBreakerRegistry();
    const a = registry.get('provider-a');
    const b = registry.get('provider-a');

    assert.equal(a, b);
  });

  it('canRequest delegates to breaker', () => {
    const registry = new CircuitBreakerRegistry();
    assert.equal(registry.canRequest('provider-a'), true);

    // Trip the breaker via failures (forceState doesn't set lastFailureTime)
    const breaker = registry.get('provider-a');
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    assert.equal(breaker.getState(), CircuitState.OPEN);
    assert.equal(registry.canRequest('provider-a'), false);
  });

  it('always allows requests when disabled', () => {
    const registry = new CircuitBreakerRegistry(false);
    const breaker = registry.get('provider-a');
    breaker.forceState(CircuitState.OPEN);

    // Even though breaker is open, registry is disabled so it passes
    assert.equal(registry.canRequest('provider-a'), true);
  });

  it('recordSuccess/recordFailure are no-ops when disabled', () => {
    const registry = new CircuitBreakerRegistry(false);
    registry.recordFailure('provider-a');
    registry.recordFailure('provider-a');
    registry.recordFailure('provider-a');
    registry.recordFailure('provider-a');
    registry.recordFailure('provider-a');

    // The breaker was not actually updated (disabled skips)
    assert.equal(registry.canRequest('provider-a'), true);
  });

  it('getAllStats returns stats for all registered breakers', () => {
    const registry = new CircuitBreakerRegistry();
    registry.get('a');
    registry.get('b');
    registry.recordFailure('a');

    const stats = registry.getAllStats();
    assert.equal(stats.length, 2);

    const aStats = stats.find((s) => s.name === 'a');
    assert.ok(aStats);
    assert.equal(aStats.failures, 1);
  });
});

// ── withCircuitBreaker helper ────────────────────────────────

describe('withCircuitBreaker()', () => {
  it('returns result on success and records success', async () => {
    const result = await withCircuitBreaker('with-cb-test', async () => 'ok');
    assert.equal(result, 'ok');
  });

  it('throws original error on failure and records failure', async () => {
    await assert.rejects(
      () => withCircuitBreaker('with-cb-fail', async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
  });

  it('throws CircuitBreakerOpenError when breaker is open', async () => {
    // Trip the breaker via the global registry using failures
    const { getCircuitBreakerRegistry } = await import('../src/core/circuit-breaker.js');
    const registry = getCircuitBreakerRegistry();
    const breaker = registry.get('with-cb-open');
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    assert.equal(breaker.getState(), CircuitState.OPEN);

    try {
      await withCircuitBreaker('with-cb-open', async () => 'should not run');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.equal((err as CircuitBreakerOpenError).name, 'CircuitBreakerOpenError');
      assert.ok(err.message.includes('with-cb-open'));
    }
  });
});

// ── Per-key:model granularity ──────────────────────────────

describe('Per-key:model granularity', () => {
  it('buildBreakerKey() with provider only', () => {
    assert.equal(buildBreakerKey('openai'), 'openai');
  });

  it('buildBreakerKey() with provider and apiKey', () => {
    assert.equal(buildBreakerKey('openai', 'sk-abc'), 'openai:sk-abc');
  });

  it('buildBreakerKey() with provider, apiKey, and model', () => {
    assert.equal(
      buildBreakerKey('openai', 'sk-abc', 'gpt-4o'),
      'openai:sk-abc:gpt-4o',
    );
  });

  it('different keys get independent breakers', () => {
    const registry = new CircuitBreakerRegistry();
    const breakerA = registry.getForKey('openai', 'key-1', 'gpt-4o');
    const breakerB = registry.getForKey('openai', 'key-2', 'gpt-4o');
    const breakerC = registry.getForKey('openai', 'key-1', 'gpt-3.5');

    // All are different instances
    assert.notEqual(breakerA, breakerB);
    assert.notEqual(breakerA, breakerC);
    assert.notEqual(breakerB, breakerC);

    // Tripping one doesn't affect others
    for (let i = 0; i < 5; i++) breakerA.recordFailure();
    assert.equal(breakerA.getState(), CircuitState.OPEN);
    assert.equal(breakerB.getState(), CircuitState.CLOSED);
    assert.equal(breakerC.getState(), CircuitState.CLOSED);
  });

  it('same composite key returns same breaker', () => {
    const registry = new CircuitBreakerRegistry();
    const a = registry.getForKey('openai', 'sk-1', 'gpt-4o');
    const b = registry.getForKey('openai', 'sk-1', 'gpt-4o');
    assert.equal(a, b);
  });

  it('provider-only key is backward compatible with get()', () => {
    const registry = new CircuitBreakerRegistry();
    const viaGet = registry.get('openai');
    const viaGetForKey = registry.getForKey('openai');
    assert.equal(viaGet, viaGetForKey);
  });
});

// ── Exponential backoff ────────────────────────────────────

describe('Exponential backoff', () => {
  it('uses fixed resetTimeoutMs when backoffBaseMs is null (default)', () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 2,
      resetTimeoutMs: 500,
    });
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.getState(), CircuitState.OPEN);
    // Should use fixed timeout regardless of consecutive failures
    assert.equal(breaker.getCurrentCooldownMs(), 500);
  });

  it('uses exponential backoff when backoffBaseMs is set', () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 1,
      backoffBaseMs: 100,
      backoffMultiplier: 2,
      backoffMaxMs: 10_000,
    });

    // First failure: consecutiveFailures=1 → 100 * 2^0 = 100
    breaker.recordFailure();
    assert.equal(breaker.getCurrentCooldownMs(), 100);
  });

  it('cooldown increases with each consecutive failure', () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 1,
      resetTimeoutMs: 50,
      backoffBaseMs: 100,
      backoffMultiplier: 2,
      backoffMaxMs: 100_000,
    });

    breaker.recordFailure(); // consecutiveFailures=1 → 100
    assert.equal(breaker.getCurrentCooldownMs(), 100);

    breaker.recordFailure(); // consecutiveFailures=2 → 200
    assert.equal(breaker.getCurrentCooldownMs(), 200);

    breaker.recordFailure(); // consecutiveFailures=3 → 400
    assert.equal(breaker.getCurrentCooldownMs(), 400);

    breaker.recordFailure(); // consecutiveFailures=4 → 800
    assert.equal(breaker.getCurrentCooldownMs(), 800);
  });

  it('cooldown does not exceed backoffMaxMs', () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 1,
      backoffBaseMs: 1000,
      backoffMultiplier: 10,
      backoffMaxMs: 5000,
    });

    // 10 failures → 1000 * 10^9 = way over max
    for (let i = 0; i < 10; i++) breaker.recordFailure();
    assert.equal(breaker.getCurrentCooldownMs(), 5000);
  });

  it('backoff resets after HALF_OPEN success', async () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 1,
      resetTimeoutMs: 50,
      backoffBaseMs: 100,
      backoffMultiplier: 2,
      backoffMaxMs: 100_000,
      halfOpenSuccessThreshold: 1,
    });

    // Fail several times to build up consecutive failures
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.getStats().consecutiveFailures, 3);

    // Wait for cooldown and transition to HALF_OPEN
    await new Promise((resolve) => setTimeout(resolve, 500));
    breaker.canRequest(); // triggers HALF_OPEN
    assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

    // Success resets consecutive failures
    breaker.recordSuccess();
    assert.equal(breaker.getState(), CircuitState.CLOSED);
    assert.equal(breaker.getStats().consecutiveFailures, 0);
  });
});

// ── Enhanced stats ─────────────────────────────────────────

describe('Enhanced stats', () => {
  it('tracks successes count', () => {
    const breaker = new CircuitBreaker('test');
    breaker.recordSuccess();
    breaker.recordSuccess();
    breaker.recordSuccess();
    assert.equal(breaker.getStats().successes, 3);
  });

  it('tracks lastFailureTime', () => {
    const breaker = new CircuitBreaker('test');
    const before = Date.now();
    breaker.recordFailure();
    const after = Date.now();

    const stats = breaker.getStats();
    assert.ok(stats.lastFailureTime >= before);
    assert.ok(stats.lastFailureTime <= after);
  });

  it('tracks consecutiveFailures', () => {
    const breaker = new CircuitBreaker('test');
    breaker.recordFailure();
    breaker.recordFailure();
    assert.equal(breaker.getStats().consecutiveFailures, 2);

    breaker.recordSuccess();
    assert.equal(breaker.getStats().consecutiveFailures, 0);
  });

  it('reports currentCooldownMs', () => {
    const breaker = new CircuitBreaker('test', {
      resetTimeoutMs: 999,
    });
    assert.equal(breaker.getStats().currentCooldownMs, 999);
  });
});

// ── Runtime config ─────────────────────────────────────────

describe('Runtime config', () => {
  it('updateConfig changes breaker config', () => {
    const breaker = new CircuitBreaker('test');
    breaker.updateConfig({ failureThreshold: 10 });
    assert.equal(breaker.getConfig().failureThreshold, 10);
  });

  it('registry updateDefaultConfig affects existing and new breakers', () => {
    const registry = new CircuitBreakerRegistry();
    const existing = registry.get('existing');

    registry.updateDefaultConfig({ failureThreshold: 99 });
    assert.equal(existing.getConfig().failureThreshold, 99);

    const newBreaker = registry.get('new-one');
    assert.equal(newBreaker.getConfig().failureThreshold, 99);
  });

  it('getDefaultConfig returns merged defaults', () => {
    const registry = new CircuitBreakerRegistry();
    const config = registry.getDefaultConfig();

    assert.equal(config.failureThreshold, 5);
    assert.equal(config.backoffBaseMs, null);
    assert.equal(config.backoffMultiplier, 2);
    assert.equal(config.backoffMaxMs, 300_000);
  });
});
