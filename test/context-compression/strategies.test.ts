/**
 * Compression strategies — extractive, structural, token-budget.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ExtractiveStrategy,
  StructuralStrategy,
  TokenBudgetStrategy,
  getStrategy,
} from '../../src/context-compression/strategies.js';

describe('ExtractiveStrategy', () => {
  const strategy = new ExtractiveStrategy();

  it('has the correct name', () => {
    assert.equal(strategy.name, 'extractive');
  });

  it('returns empty string for empty input', () => {
    assert.equal(strategy.compress(''), '');
  });

  it('returns original for single sentence', () => {
    const input = 'This is a single sentence.';
    assert.equal(strategy.compress(input), input);
  });

  it('reduces content at ratio 0.5', () => {
    const sentences = [
      'First sentence is important.',
      'Second sentence has some info.',
      'Third sentence is here.',
      'Fourth sentence matters too.',
      'Fifth sentence is the last.',
      'Sixth sentence ends it all.',
    ];
    const input = sentences.join(' ');
    const result = strategy.compress(input, { ratio: 0.5 });

    // Should keep ~50% of sentences (3 out of 6)
    const resultSentences = result.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    assert.ok(resultSentences.length <= 4, `Expected ~3 sentences, got ${resultSentences.length}`);
    assert.ok(resultSentences.length >= 2, `Expected ~3 sentences, got ${resultSentences.length}`);
  });

  it('preserves original sentence order', () => {
    const input = 'Alpha sentence. Beta sentence. Gamma sentence. Delta sentence.';
    const result = strategy.compress(input, { ratio: 0.5 });

    // Whatever sentences are kept, they should be in original order
    const kept = result.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    const original = input.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);

    let lastIdx = -1;
    for (const s of kept) {
      const idx = original.indexOf(s);
      assert.ok(idx > lastIdx, `Sentence order not preserved: "${s}"`);
      lastIdx = idx;
    }
  });

  it('scores keyword sentences higher', () => {
    const input = 'A filler sentence. This is a critical requirement that must be met. Another filler.';
    const result = strategy.compress(input, { ratio: 0.4 });

    // The keyword sentence should be kept
    assert.ok(result.includes('critical'), 'Expected keyword sentence to be retained');
  });
});

describe('StructuralStrategy', () => {
  const strategy = new StructuralStrategy();

  it('has the correct name', () => {
    assert.equal(strategy.name, 'structural');
  });

  it('returns empty string for empty input', () => {
    assert.equal(strategy.compress(''), '');
  });

  it('keeps headings and first lines of sections', () => {
    const input = [
      '# Title',
      'First paragraph under title.',
      'Second paragraph ignored.',
      '## Section',
      'First line of section.',
      'Second line ignored.',
    ].join('\n');

    const result = strategy.compress(input);
    assert.ok(result.includes('# Title'));
    assert.ok(result.includes('First paragraph under title.'));
    assert.ok(result.includes('## Section'));
    assert.ok(result.includes('First line of section.'));
    assert.ok(!result.includes('Second paragraph ignored.'));
    assert.ok(!result.includes('Second line ignored.'));
  });

  it('keeps list items', () => {
    const input = [
      '# Features',
      'Overview text.',
      '- Feature one',
      '- Feature two',
      'Some other text.',
    ].join('\n');

    const result = strategy.compress(input);
    assert.ok(result.includes('- Feature one'));
    assert.ok(result.includes('- Feature two'));
  });

  it('falls back to first lines for non-structured content', () => {
    const input = 'Line one.\nLine two.\nLine three.\nLine four.';
    const result = strategy.compress(input);

    assert.ok(result.length > 0, 'Should produce some output for non-structured content');
  });
});

describe('TokenBudgetStrategy', () => {
  const strategy = new TokenBudgetStrategy();

  it('has the correct name', () => {
    assert.equal(strategy.name, 'token-budget');
  });

  it('returns empty string for empty input', () => {
    assert.equal(strategy.compress(''), '');
  });

  it('returns original if within budget', () => {
    const input = 'Short text.';
    assert.equal(strategy.compress(input, { maxChars: 100 }), input);
  });

  it('truncates to maxChars budget', () => {
    const input = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
    const result = strategy.compress(input, { maxChars: 30 });

    assert.ok(result.length <= 30, `Expected <= 30 chars, got ${result.length}`);
  });

  it('breaks at sentence boundary when possible', () => {
    const input = 'First sentence. Second sentence is longer. Third sentence.';
    const result = strategy.compress(input, { maxChars: 50 });

    // Should end at a sentence boundary
    assert.ok(result.endsWith('.'), `Expected to end at sentence boundary: "${result}"`);
  });

  it('hard-truncates if first sentence exceeds budget', () => {
    const input = 'This is a very long first sentence that exceeds the budget significantly.';
    const result = strategy.compress(input, { maxChars: 20 });

    assert.equal(result.length, 20);
    assert.equal(result, input.slice(0, 20));
  });

  it('uses ratio when maxChars not specified', () => {
    const input = 'A'.repeat(100);
    const result = strategy.compress(input, { ratio: 0.3 });

    assert.ok(result.length <= 30, `Expected <= 30 chars with ratio 0.3, got ${result.length}`);
  });
});

describe('getStrategy', () => {
  it('returns extractive strategy', () => {
    assert.equal(getStrategy('extractive').name, 'extractive');
  });

  it('returns structural strategy', () => {
    assert.equal(getStrategy('structural').name, 'structural');
  });

  it('returns token-budget strategy', () => {
    assert.equal(getStrategy('token-budget').name, 'token-budget');
  });

  it('throws for unknown strategy', () => {
    assert.throws(
      () => getStrategy('nonexistent'),
      /Unknown compression strategy/,
    );
  });
});
