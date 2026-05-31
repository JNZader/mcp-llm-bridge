/**
 * Local LLM task router tests — classification and threshold checks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyForOffload, meetsOffloadThreshold } from '../../src/local-llm/router.js';
import { classify } from '../../src/classification/index.js';

// ── classifyForOffload ──────────────────────────────────────

describe('classifyForOffload', () => {
  it('keeps parity with unified classify for local-safe tasks', () => {
    const prompts = [
      'Write a commit message for these changes',
      'Generate boilerplate for a new React component',
      'Convert this YAML to JSON format',
      'Check this code for lint errors',
      'Summarize this README for me',
      'Translate to Spanish: Hello, world',
    ];

    for (const prompt of prompts) {
      const unified = classify(prompt);
      const local = classifyForOffload(prompt);

      assert.equal(local.task, unified.task);
      assert.equal(local.confidence, unified.confidence);
      assert.equal(local.reason, unified.reason);
      assert.equal(local.shouldOffload, true);
    }
  });

  it('keeps large-context explicitly blocked for local offload', () => {
    const prompt = 'x'.repeat(400_001);
    const result = classifyForOffload(prompt);

    assert.equal(result.task, 'large-context');
    assert.equal(result.shouldOffload, false);
  });

  it('keeps code-review explicitly blocked for local offload', () => {
    const result = classifyForOffload('Please review this code for potential bugs');

    assert.equal(result.task, 'code-review');
    assert.equal(result.shouldOffload, false);
  });

  it('keeps fast-completion explicitly blocked for local offload', () => {
    const result = classifyForOffload('hi');

    assert.equal(result.task, 'fast-completion');
    assert.equal(result.shouldOffload, false);
  });

  it('keeps default explicitly blocked for local offload', () => {
    const prompt = 'Please help me write a function that processes user input and validates each field against the schema. The function should handle edge cases like empty strings, null values, and numbers outside the expected range. I need this to work with our existing validation library and return appropriate error messages for each failure case. '.repeat(2);
    const result = classifyForOffload(prompt);

    assert.equal(result.task, 'default');
    assert.equal(result.shouldOffload, false);
  });

  it('keeps not-offloadable explicitly blocked for local offload', () => {
    const result = classifyForOffload('Perform a security audit of this auth module');

    assert.equal(result.task, 'not-offloadable');
    assert.equal(result.shouldOffload, false);
  });

  it('stays deterministic for mixed prompts', () => {
    const prompt = 'Convert to JSON and summarize this data';
    const first = classifyForOffload(prompt);
    const second = classifyForOffload(prompt);
    const unified = classify(prompt);

    assert.deepEqual(first, second);
    assert.equal(first.task, unified.task);
    assert.equal(first.confidence, unified.confidence);
    assert.equal(first.reason, unified.reason);
  });
});

// ── meetsOffloadThreshold ──────────────────────────────────

describe('meetsOffloadThreshold', () => {
  it('passes when confidence exceeds threshold', () => {
    const classification = {
      task: 'commit-message' as const,
      confidence: 0.95,
      shouldOffload: true,
      reason: 'test',
    };
    assert.equal(meetsOffloadThreshold(classification, 0.7), true);
  });

  it('fails when confidence below threshold', () => {
    const classification = {
      task: 'summarization' as const,
      confidence: 0.5,
      shouldOffload: true,
      reason: 'test',
    };
    assert.equal(meetsOffloadThreshold(classification, 0.7), false);
  });

  it('fails when shouldOffload is false regardless of confidence', () => {
    const classification = {
      task: 'not-offloadable' as const,
      confidence: 0.95,
      shouldOffload: false,
      reason: 'test',
    };
    assert.equal(meetsOffloadThreshold(classification, 0.7), false);
  });

  it('passes at exact threshold', () => {
    const classification = {
      task: 'boilerplate' as const,
      confidence: 0.7,
      shouldOffload: true,
      reason: 'test',
    };
    assert.equal(meetsOffloadThreshold(classification, 0.7), true);
  });
});
