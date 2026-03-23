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
