/**
 * Pricing module tests — calculateCost, fuzzy matching, unknown models.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculateCost, getModelPrice, getPriceTable } from '../src/core/pricing.js';

describe('calculateCost', () => {
  it('calculates cost for known model', () => {
    // gpt-4o: $2.50 input, $10.00 output per 1M tokens
    const cost = calculateCost('gpt-4o', 1_000_000, 1_000_000);
    assert.equal(cost, 12.50);
  });

  it('calculates cost for partial token counts', () => {
    // gpt-4o: $2.50/M input, $10.00/M output
    const cost = calculateCost('gpt-4o', 500, 200);
    const expected = (500 / 1_000_000) * 2.50 + (200 / 1_000_000) * 10.00;
    assert.equal(cost, expected);
  });

  it('returns $0 for zero tokens', () => {
    const cost = calculateCost('gpt-4o', 0, 0);
    assert.equal(cost, 0);
  });

  it('returns $0 for unknown model (does not throw)', () => {
    const cost = calculateCost('unknown-model-xyz', 1_000_000, 1_000_000);
    assert.equal(cost, 0);
  });
});

describe('fuzzy matching', () => {
  it('matches model with date suffix stripped', () => {
    // "claude-sonnet-4-20250514" has an exact entry
    const price = getModelPrice('claude-sonnet-4-20250514');
    assert.ok(price, 'should match claude-sonnet-4-20250514');
    assert.equal(price.inputPerMTok, 3.00);
  });

  it('matches model with dots replaced by hyphens', () => {
    // "claude-3-5-sonnet" should match "claude-3.5-sonnet" (normalized: both become "claude-3-5-sonnet")
    const price = getModelPrice('claude-3-5-sonnet');
    assert.ok(price, 'should match claude-3.5-sonnet via normalization');
    assert.equal(price.inputPerMTok, 3.00);
  });

  it('matches model with version suffix via prefix matching', () => {
    // "gpt-4o-2024-05-13" should match "gpt-4o" via prefix
    const price = getModelPrice('gpt-4o-2024-05-13');
    assert.ok(price, 'should match gpt-4o via prefix');
    assert.equal(price.inputPerMTok, 2.50);
  });

  it('strips -latest suffix', () => {
    const price = getModelPrice('gpt-4o-latest');
    assert.ok(price, 'should match gpt-4o after stripping -latest');
    assert.equal(price.inputPerMTok, 2.50);
  });

  it('returns null for truly unknown model', () => {
    const price = getModelPrice('nonexistent-model');
    assert.equal(price, null);
  });
});

describe('getPriceTable', () => {
  it('returns a non-empty table', () => {
    const table = getPriceTable();
    assert.ok(Object.keys(table).length > 10, 'should have many models');
  });

  it('returns a defensive copy', () => {
    const table = getPriceTable();
    table['test-model'] = { inputPerMTok: 999, outputPerMTok: 999 };

    // Original should be unaffected
    const table2 = getPriceTable();
    assert.equal(table2['test-model'], undefined);
  });
});
