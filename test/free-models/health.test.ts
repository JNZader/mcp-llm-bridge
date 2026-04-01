/**
 * Free Model Health Checker tests — health probing and reliability tracking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HealthChecker } from '../../src/free-models/health.js';

// ── HealthChecker ──────────────────────────────────────────

describe('HealthChecker', () => {
  it('returns undefined for unchecked model', () => {
    const checker = new HealthChecker();
    assert.equal(checker.getHealth('nonexistent'), undefined);
    checker.destroy();
  });

  it('returns 0.5 reliability for unknown model (neutral score)', () => {
    const checker = new HealthChecker();
    assert.equal(checker.getReliability('nonexistent'), 0.5);
    checker.destroy();
  });

  it('getAllHealth() returns empty map initially', () => {
    const checker = new HealthChecker();
    const all = checker.getAllHealth();
    assert.equal(all.size, 0);
    checker.destroy();
  });

  it('destroy() clears state without errors', () => {
    const checker = new HealthChecker();
    checker.destroy();
    // Should be safe to call multiple times
    checker.destroy();
    assert.equal(checker.getAllHealth().size, 0);
  });

  it('stopPeriodicChecks() is safe when no checks running', () => {
    const checker = new HealthChecker();
    // Should not throw
    checker.stopPeriodicChecks();
    checker.destroy();
  });
});
