/**
 * Task classifier tests — heuristic classification.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classify, estimateTokens } from '../../src/bridge/classifier.js';

// ── Token Estimation ─────────────────────────────────────────

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcdefgh'), 2);
    assert.equal(estimateTokens(''), 0);
  });

  it('rounds up partial tokens', () => {
    assert.equal(estimateTokens('abcde'), 2); // 5/4 = 1.25 → 2
  });
});

// ── Classification ───────────────────────────────────────────

describe('classify', () => {
  it('classifies large context by token count', () => {
    // 400001 chars → ~100001 tokens → exceeds 100000 threshold
    const longPrompt = 'x'.repeat(400_001);
    assert.equal(classify(longPrompt), 'large-context');
  });

  it('classifies large context with custom threshold', () => {
    const prompt = 'x'.repeat(201); // 51 tokens
    assert.equal(
      classify(prompt, { largeContextThreshold: 50 }),
      'large-context',
    );
  });

  it('classifies code review by keyword "review"', () => {
    assert.equal(
      classify('Please review this code for potential bugs and issues'),
      'code-review',
    );
  });

  it('classifies code review by keyword "audit"', () => {
    assert.equal(
      classify('Audit this module for security vulnerabilities'),
      'code-review',
    );
  });

  it('classifies code review by keyword "analyze"', () => {
    assert.equal(
      classify('Analyze the performance of this function and suggest improvements'),
      'code-review',
    );
  });

  it('classifies code review by keyword "refactor"', () => {
    assert.equal(
      classify('Refactor this class to follow SOLID principles'),
      'code-review',
    );
  });

  it('keyword matching is case insensitive', () => {
    assert.equal(classify('REVIEW this CODE'), 'code-review');
    assert.equal(classify('Security Review needed'), 'code-review');
  });

  it('classifies short prompts as fast-completion', () => {
    assert.equal(classify('What is TypeScript?'), 'fast-completion');
    assert.equal(classify('Fix this bug'), 'fast-completion');
  });

  it('classifies short prompts with custom threshold', () => {
    assert.equal(
      classify('Hello world', { fastCompletionMaxLength: 5 }),
      'default',
    );
  });

  it('returns default for medium prompts without keywords', () => {
    // Create a 600-char prompt without any code-review keywords
    const mediumPrompt = 'Please help me write a function that processes user input and validates each field against the schema. The function should handle edge cases like empty strings, null values, and numbers outside the expected range. I need this to work with our existing validation library and return appropriate error messages for each failure case. '.repeat(2);
    assert.equal(classify(mediumPrompt), 'default');
  });

  it('prioritizes large-context over code-review keywords', () => {
    // Long prompt WITH code review keywords — large-context should win
    const longReview = 'review '.repeat(60_000); // ~420000 chars → ~105000 tokens
    assert.equal(classify(longReview), 'large-context');
  });

  it('prioritizes code-review over fast-completion for short prompts with keywords', () => {
    // Short prompt with "review" keyword — code-review should win over fast-completion
    assert.equal(classify('review this'), 'code-review');
  });

  it('supports custom keywords', () => {
    assert.equal(
      classify('please lint this file', { codeReviewKeywords: ['lint'] }),
      'code-review',
    );
  });
});
