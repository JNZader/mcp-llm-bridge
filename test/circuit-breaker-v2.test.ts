/**
 * Circuit Breaker V2 tests — TDD (RED phase first).
 *
 * Tests 3-state transitions and exponential backoff for octopus-style
circuit breaker.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CircuitBreakerV2,
  CircuitState,
} from '../src/circuit-breaker/circuit-breaker-v2.js';

describe('CircuitBreakerV2', () => {
  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      const cb = new CircuitBreakerV2();
      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.state, CircuitState.CLOSED);
    });

    it('should use default config when none provided', () => {
      const cb = new CircuitBreakerV2();
      const config = cb.getConfig();
      assert.strictEqual(config.failureThreshold, 5);
      assert.strictEqual(config.baseCooldownMs, 60000);
      assert.strictEqual(config.maxCooldownMs, 600000);
      assert.strictEqual(config.halfOpenMaxRequests, 3);
    });

    it('should accept partial config overrides', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });
      const config = cb.getConfig();
      assert.strictEqual(config.failureThreshold, 3);
      assert.strictEqual(config.baseCooldownMs, 60000); // default
    });
  });

  describe('CLOSED → OPEN Transition', () => {
    it('should stay CLOSED below failure threshold', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.state, CircuitState.CLOSED);
    });

    it('should transition to OPEN after threshold failures', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o'); // 3rd failure

      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.state, CircuitState.OPEN);
      assert.ok(result.remainingCooldown! > 0);
    });

    it('should track consecutive failures per key independently', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });

      // Fail key-1 twice
      cb.recordFailure('openai', 'key-1', 'gpt-4o');
      cb.recordFailure('openai', 'key-1', 'gpt-4o');

      // Fail key-2 three times (should trip)
      cb.recordFailure('openai', 'key-2', 'gpt-4o');
      cb.recordFailure('openai', 'key-2', 'gpt-4o');
      cb.recordFailure('openai', 'key-2', 'gpt-4o');

      // key-1 should still be CLOSED
      const result1 = cb.canExecute('openai', 'key-1', 'gpt-4o');
      assert.strictEqual(result1.allowed, true);
      assert.strictEqual(result1.state, CircuitState.CLOSED);

      // key-2 should be OPEN
      const result2 = cb.canExecute('openai', 'key-2', 'gpt-4o');
      assert.strictEqual(result2.allowed, false);
      assert.strictEqual(result2.state, CircuitState.OPEN);
    });
  });

  describe('OPEN → HALF_OPEN Transition', () => {
    it('should report remaining cooldown while OPEN', () => {
      const cb = new CircuitBreakerV2({
        failureThreshold: 1,
        baseCooldownMs: 60000,
      });

      cb.recordFailure('openai', 'key1', 'gpt-4o');

      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.state, CircuitState.OPEN);
      assert.ok(result.remainingCooldown! <= 60000);
      assert.ok(result.remainingCooldown! > 0);
    });

    it('should transition to HALF_OPEN after cooldown expires', () => {
      const cb = new CircuitBreakerV2({
        failureThreshold: 1,
        baseCooldownMs: 50, // Short for testing
      });

      // Trip the breaker
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.OPEN);

      // Wait for cooldown
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = cb.canExecute('openai', 'key1', 'gpt-4o');
          assert.strictEqual(result.allowed, true);
          assert.strictEqual(result.state, CircuitState.HALF_OPEN);
          resolve();
        }, 60);
      });
    });
  });

  describe('HALF_OPEN → CLOSED Transition', () => {
    it('should transition to CLOSED after halfOpenMaxRequests successes', () => {
      const cb = new CircuitBreakerV2({
        failureThreshold: 1,
        baseCooldownMs: 50,
        halfOpenMaxRequests: 2,
      });

      // Trip and wait
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Enter HALF_OPEN with first canExecute
          cb.canExecute('openai', 'key1', 'gpt-4o');
          assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.HALF_OPEN);

          // First success - should stay HALF_OPEN
          cb.recordSuccess('openai', 'key1', 'gpt-4o');
          assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.HALF_OPEN);

          // Need another request in HALF_OPEN (canExecute increments counter)
          cb.canExecute('openai', 'key1', 'gpt-4o');

          // Second success - should close
          cb.recordSuccess('openai', 'key1', 'gpt-4o');
          const result = cb.canExecute('openai', 'key1', 'gpt-4o');
          assert.strictEqual(result.allowed, true);
          assert.strictEqual(result.state, CircuitState.CLOSED);
          resolve();
        }, 60);
      });
    });
  });

  describe('HALF_OPEN → OPEN Transition', () => {
    it('should go back to OPEN on any failure in HALF_OPEN', () => {
      const cb = new CircuitBreakerV2({
        failureThreshold: 1,
        baseCooldownMs: 50,
        halfOpenMaxRequests: 3,
      });

      // Trip and wait
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Enter HALF_OPEN
          cb.canExecute('openai', 'key1', 'gpt-4o');
          assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.HALF_OPEN);

          // One success - should stay HALF_OPEN
          cb.canExecute('openai', 'key1', 'gpt-4o');
          cb.recordSuccess('openai', 'key1', 'gpt-4o');
          assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.HALF_OPEN);

          // Failure - should go back to OPEN
          cb.recordFailure('openai', 'key1', 'gpt-4o');
          const result = cb.canExecute('openai', 'key1', 'gpt-4o');
          assert.strictEqual(result.allowed, false);
          assert.strictEqual(result.state, CircuitState.OPEN);
          resolve();
        }, 60);
      });
    });
  });

  describe('Exponential Backoff', () => {
    it('should use 60s cooldown on first trip', () => {
      const cb = new CircuitBreakerV2({
        failureThreshold: 1,
        baseCooldownMs: 60000,
        maxCooldownMs: 600000,
      });

      cb.recordFailure('openai', 'key1', 'gpt-4o');

      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      assert.strictEqual(result.allowed, false);
      // First trip: tripCount=1 → 60s * 2^0 = 60s
      assert.ok(result.remainingCooldown! <= 60000);
      assert.ok(result.remainingCooldown! > 59000); // Allow small timing variance
    });

    it('should use 120s cooldown on second trip', () => {
      const cb = new CircuitBreakerV2({
        failureThreshold: 1,
        baseCooldownMs: 60000,
        maxCooldownMs: 600000,
      });

      // First trip
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      const state1 = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.strictEqual(state1.tripCount, 1);

      // Simulate recovery and second trip
      cb.reset('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      const state2 = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.strictEqual(state2.tripCount, 2);

      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      assert.strictEqual(result.allowed, false);
      // Second trip: tripCount=2 → 60s * 2^1 = 120s
      assert.ok(result.remainingCooldown! <= 120000);
      assert.ok(result.remainingCooldown! > 110000);
    });

    it('should use 240s cooldown on third trip', () => {
      const cb = new CircuitBreakerV2({
        failureThreshold: 1,
        baseCooldownMs: 60000,
        maxCooldownMs: 600000,
      });

      // Trip 3 times with resets
      for (let i = 0; i < 3; i++) {
        cb.reset('openai', 'key1', 'gpt-4o');
        cb.recordFailure('openai', 'key1', 'gpt-4o');
      }

      const state = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.strictEqual(state.tripCount, 3);

      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      // Third trip: tripCount=3 → 60s * 2^2 = 240s
      assert.ok(result.remainingCooldown! <= 240000);
      assert.ok(result.remainingCooldown! > 230000);
    });

    it('should cap cooldown at maxCooldownMs', () => {
      const cb = new CircuitBreakerV2({
        failureThreshold: 1,
        baseCooldownMs: 60000,
        maxCooldownMs: 300000, // 5 min cap (lower than 600s)
      });

      // Trip many times
      for (let i = 0; i < 10; i++) {
        cb.reset('openai', 'key1', 'gpt-4o');
        cb.recordFailure('openai', 'key1', 'gpt-4o');
      }

      const state = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.ok(state.tripCount >= 5);

      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      // Should be capped at maxCooldownMs
      assert.ok(result.remainingCooldown! <= 300000);
    });
  });

  describe('Success Resets Failures', () => {
    it('should reset consecutiveFailures on success in CLOSED state', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      const before = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.strictEqual(before.consecutiveFailures, 2);

      cb.recordSuccess('openai', 'key1', 'gpt-4o');

      const after = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.strictEqual(after.consecutiveFailures, 0);
    });

    it('should not trip if failures reset before threshold', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordSuccess('openai', 'key1', 'gpt-4o');

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      // Only 2 consecutive failures, threshold is 3
      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      assert.strictEqual(result.state, CircuitState.CLOSED);
    });
  });

  describe('State Monitoring', () => {
    it('should return null for unknown keys', () => {
      const cb = new CircuitBreakerV2();
      const state = cb.getState('unknown', 'key', 'model');
      assert.strictEqual(state, null);
    });

    it('should return state for known keys', () => {
      const cb = new CircuitBreakerV2();

      // Initialize by checking
      cb.canExecute('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      const state = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.strictEqual(state.state, CircuitState.CLOSED);
      assert.strictEqual(state.consecutiveFailures, 1);
      assert.strictEqual(state.tripCount, 0);
      assert.ok(state.lastFailureTime > 0);
    });

    it('should return copy of state to prevent mutation', () => {
      const cb = new CircuitBreakerV2();

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      const state = cb.getState('openai', 'key1', 'gpt-4o')!;

      // Mutate returned object
      state.consecutiveFailures = 999;

      // Should not affect internal state
      const fresh = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.strictEqual(fresh.consecutiveFailures, 1);
    });

    it('should return all states', () => {
      const cb = new CircuitBreakerV2();

      cb.canExecute('openai', 'key1', 'gpt-4o');
      cb.canExecute('anthropic', 'key2', 'claude-3');
      cb.canExecute('google', 'key3', 'gemini');

      const all = cb.getAllStates();
      assert.strictEqual(all.length, 3);

      const keys = all.map((s) => s.key).sort();
      assert.deepStrictEqual(keys, [
        'anthropic:key2:claude-3',
        'google:key3:gemini',
        'openai:key1:gpt-4o',
      ]);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset OPEN circuit to CLOSED', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 1 });

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.OPEN);

      cb.reset('openai', 'key1', 'gpt-4o');

      const result = cb.canExecute('openai', 'key1', 'gpt-4o');
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.state, CircuitState.CLOSED);
    });

    it('should NOT reset tripCount on manual reset (for exponential backoff)', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 1 });

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      assert.strictEqual(cb.getState('openai', 'key1', 'gpt-4o')!.tripCount, 1);

      cb.reset('openai', 'key1', 'gpt-4o');

      // tripCount should persist for exponential backoff
      const state = cb.getState('openai', 'key1', 'gpt-4o')!;
      assert.strictEqual(state.tripCount, 1);
    });
  });

  describe('Runtime Config Updates', () => {
    it('should update config at runtime', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });
      assert.strictEqual(cb.getConfig().failureThreshold, 3);

      cb.updateConfig({ failureThreshold: 10 });
      assert.strictEqual(cb.getConfig().failureThreshold, 10);
    });

    it('should use new threshold after update', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });

      // Fail 3 times with old threshold
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      // Circuit should be OPEN
      assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.OPEN);

      // Reset and update threshold
      cb.reset('openai', 'key1', 'gpt-4o');
      cb.updateConfig({ failureThreshold: 5 });

      // Should stay CLOSED with 3 failures
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.CLOSED);
    });
  });

  describe('Per-Model Isolation', () => {
    it('should track different models independently', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 3 });

      // Fail gpt-4o 3 times
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('openai', 'key1', 'gpt-4o');

      // gpt-4o should be OPEN
      assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.OPEN);

      // gpt-3.5 should still be CLOSED
      const result = cb.canExecute('openai', 'key1', 'gpt-3.5');
      assert.strictEqual(result.state, CircuitState.CLOSED);
    });

    it('should track different providers independently', () => {
      const cb = new CircuitBreakerV2({ failureThreshold: 1 });

      cb.recordFailure('openai', 'key1', 'gpt-4o');
      cb.recordFailure('anthropic', 'key1', 'claude-3');

      // Both should be OPEN independently
      assert.strictEqual(cb.canExecute('openai', 'key1', 'gpt-4o').state, CircuitState.OPEN);
      assert.strictEqual(cb.canExecute('anthropic', 'key1', 'claude-3').state, CircuitState.OPEN);
    });
  });
});
