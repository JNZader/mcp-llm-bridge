/**
 * Model routing types tests — cost tier comparison.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compareCostTiers, COST_TIER } from '../../src/model-routing/types.js';

describe('compareCostTiers', () => {
  it('free < cheap', () => {
    assert.ok(compareCostTiers(COST_TIER.FREE, COST_TIER.CHEAP) < 0);
  });

  it('cheap < standard', () => {
    assert.ok(compareCostTiers(COST_TIER.CHEAP, COST_TIER.STANDARD) < 0);
  });

  it('standard < expensive', () => {
    assert.ok(compareCostTiers(COST_TIER.STANDARD, COST_TIER.EXPENSIVE) < 0);
  });

  it('expensive > free', () => {
    assert.ok(compareCostTiers(COST_TIER.EXPENSIVE, COST_TIER.FREE) > 0);
  });

  it('same tier returns 0', () => {
    assert.equal(compareCostTiers(COST_TIER.STANDARD, COST_TIER.STANDARD), 0);
  });
});
