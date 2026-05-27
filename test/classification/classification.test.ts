/**
 * Classification module tests — unified taxonomy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classify, estimateTokens, type TaskType, type ClassificationResult } from '../../src/classification/index.js';

// ── Type exports ────────────────────────────────────────────

describe('type exports', () => {
  it('exports TaskType string union', () => {
    const t: TaskType = 'code-review';
    assert.equal(t, 'code-review');
  });

  it('exports ClassificationResult interface', () => {
    const r: ClassificationResult = {
      task: 'default',
      confidence: 0.5,
    };
    assert.equal(r.task, 'default');
  });
});

// ── Unified classify function ──────────────────────────────

describe('classify', () => {
  // Bridge taxonomy scenarios
  it('classifies large context by token count', () => {
    const longPrompt = 'x'.repeat(400_001);
    assert.equal(classify(longPrompt).task, 'large-context');
  });

  it('classifies code review by keyword', () => {
    const result = classify('Please review this code for potential bugs');
    assert.equal(result.task, 'code-review');
  });

  it('classifies short prompts as fast-completion', () => {
    assert.equal(classify('What is TypeScript?').task, 'fast-completion');
  });

  it('returns default for medium prompts without keywords', () => {
    const mediumPrompt = 'Please help me write a function that processes user input and validates each field against the schema. The function should handle edge cases like empty strings, null values, and numbers outside the expected range. I need this to work with our existing validation library and return appropriate error messages for each failure case. '.repeat(2);
    assert.equal(classify(mediumPrompt).task, 'default');
  });

  // Local-LLM taxonomy scenarios
  it('classifies commit message requests', () => {
    const result = classify('Write a commit message for these changes');
    assert.equal(result.task, 'commit-message');
    assert.equal(result.shouldOffload, true);
    assert.ok(result.confidence >= 0.9);
  });

  it('classifies boilerplate generation', () => {
    const result = classify('Generate boilerplate for a new React component');
    assert.equal(result.task, 'boilerplate');
    assert.equal(result.shouldOffload, true);
  });

  it('classifies JSON conversion', () => {
    const result = classify('Convert to JSON: name=foo, age=42');
    assert.equal(result.task, 'format-conversion');
    assert.equal(result.shouldOffload, true);
  });

  it('classifies lint requests', () => {
    const result = classify('Check this code for lint errors');
    assert.equal(result.task, 'style-check');
    assert.equal(result.shouldOffload, true);
  });

  it('classifies summarization requests', () => {
    const result = classify('Summarize this README for me');
    assert.equal(result.task, 'summarization');
    assert.equal(result.shouldOffload, true);
  });

  it('classifies translation requests', () => {
    const result = classify('Translate to Spanish: Hello, world');
    assert.equal(result.task, 'translation');
    assert.equal(result.shouldOffload, true);
  });

  // Complex / security tasks — not offloadable
  it('rejects architecture discussions as not-offloadable', () => {
    const result = classify('Help me architect a microservices system');
    assert.equal(result.task, 'not-offloadable');
    assert.equal(result.shouldOffload, false);
  });

  it('rejects security audits as not-offloadable', () => {
    const result = classify('Perform a security audit of this auth module');
    assert.equal(result.task, 'not-offloadable');
    assert.equal(result.shouldOffload, false);
  });

  it('rejects code review as not-offloadable (local-llm perspective)', () => {
    // "code review" in local-llm context means PR review which is complex
    const result = classify('Do a code review of this PR');
    assert.equal(result.task, 'not-offloadable');
    assert.equal(result.shouldOffload, false);
  });

  // Edge cases
  it('returns default for empty string', () => {
    const result = classify('');
    assert.equal(result.task, 'default');
    assert.equal(result.confidence, 0.5);
  });

  it('handles prompt matching multiple categories by priority', () => {
    // "convert to json" and "summarize this" both match
    // Priority order should resolve deterministically
    const result = classify('Convert to JSON and summarize this data');
    // format-conversion has higher base confidence than summarization
    assert.ok(
      result.task === 'format-conversion' || result.task === 'summarization',
      `Expected format-conversion or summarization, got ${result.task}`,
    );
  });

  it('prioritizes large-context over all other categories', () => {
    const longReview = 'review '.repeat(60_000);
    assert.equal(classify(longReview).task, 'large-context');
  });

  it('prioritizes code-review over fast-completion for short prompts with keywords', () => {
    assert.equal(classify('review this').task, 'code-review');
  });

  it('includes confidence in result', () => {
    const result = classify('Hello world');
    assert.ok(typeof result.confidence === 'number');
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  it('includes reason in result', () => {
    const result = classify('Write a commit message');
    assert.ok(typeof result.reason === 'string');
    assert.ok(result.reason.length > 0);
  });
});

// ── estimateTokens ─────────────────────────────────────────

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcdefgh'), 2);
    assert.equal(estimateTokens(''), 0);
  });
});
