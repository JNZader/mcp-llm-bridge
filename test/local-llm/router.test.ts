/**
 * Local LLM task router tests — classification and threshold checks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyForOffload, meetsOffloadThreshold } from '../../src/local-llm/router.js';
import { OFFLOAD_TASK } from '../../src/local-llm/types.js';

// ── classifyForOffload ──────────────────────────────────────

describe('classifyForOffload', () => {
  // Commit message tasks
  it('classifies commit message requests', () => {
    const result = classifyForOffload('Write a commit message for these changes');
    assert.equal(result.task, OFFLOAD_TASK.COMMIT_MESSAGE);
    assert.equal(result.shouldOffload, true);
    assert.ok(result.confidence >= 0.9);
  });

  it('classifies conventional commit requests', () => {
    const result = classifyForOffload('Generate a conventional commit for this diff');
    assert.equal(result.task, OFFLOAD_TASK.COMMIT_MESSAGE);
    assert.equal(result.shouldOffload, true);
  });

  // Boilerplate tasks
  it('classifies boilerplate generation', () => {
    const result = classifyForOffload('Generate boilerplate for a new React component');
    assert.equal(result.task, OFFLOAD_TASK.BOILERPLATE);
    assert.equal(result.shouldOffload, true);
  });

  it('classifies scaffold requests', () => {
    const result = classifyForOffload('Scaffold a new Express router');
    assert.equal(result.task, OFFLOAD_TASK.BOILERPLATE);
    assert.equal(result.shouldOffload, true);
  });

  // Format conversion tasks
  it('classifies JSON conversion', () => {
    const result = classifyForOffload('Convert to JSON: name=foo, age=42');
    assert.equal(result.task, OFFLOAD_TASK.FORMAT_CONVERSION);
    assert.equal(result.shouldOffload, true);
  });

  it('classifies YAML to JSON conversion', () => {
    const result = classifyForOffload('Convert this YAML to JSON format');
    assert.equal(result.task, OFFLOAD_TASK.FORMAT_CONVERSION);
    assert.equal(result.shouldOffload, true);
  });

  // Style check tasks
  it('classifies lint requests', () => {
    const result = classifyForOffload('Check this code for lint errors');
    assert.equal(result.task, OFFLOAD_TASK.STYLE_CHECK);
    assert.equal(result.shouldOffload, true);
  });

  // Summarization tasks
  it('classifies summarization requests', () => {
    const result = classifyForOffload('Summarize this README for me');
    assert.equal(result.task, OFFLOAD_TASK.SUMMARIZATION);
    assert.equal(result.shouldOffload, true);
  });

  // Translation tasks
  it('classifies translation requests', () => {
    const result = classifyForOffload('Translate to Spanish: Hello, world');
    assert.equal(result.task, OFFLOAD_TASK.TRANSLATION);
    assert.equal(result.shouldOffload, true);
  });

  // Complex tasks — should NOT offload
  it('rejects architecture discussions', () => {
    const result = classifyForOffload('Help me architect a microservices system');
    assert.equal(result.task, OFFLOAD_TASK.NOT_OFFLOADABLE);
    assert.equal(result.shouldOffload, false);
  });

  it('rejects security audits', () => {
    const result = classifyForOffload('Perform a security audit of this auth module');
    assert.equal(result.task, OFFLOAD_TASK.NOT_OFFLOADABLE);
    assert.equal(result.shouldOffload, false);
  });

  it('rejects debugging requests', () => {
    const result = classifyForOffload('Debug this failing test case');
    assert.equal(result.task, OFFLOAD_TASK.NOT_OFFLOADABLE);
    assert.equal(result.shouldOffload, false);
  });

  it('rejects code review requests', () => {
    const result = classifyForOffload('Do a code review of this PR');
    assert.equal(result.task, OFFLOAD_TASK.NOT_OFFLOADABLE);
    assert.equal(result.shouldOffload, false);
  });

  // Unrecognized prompts
  it('returns not-offloadable for generic prompts', () => {
    const result = classifyForOffload('How does JavaScript handle closures?');
    assert.equal(result.task, OFFLOAD_TASK.NOT_OFFLOADABLE);
    assert.equal(result.shouldOffload, false);
  });

  // Length guard — very long prompts for commit messages should not offload
  it('rejects commit message for very long prompts', () => {
    const longPrompt = 'Write a commit message for: ' + 'x'.repeat(6000);
    const result = classifyForOffload(longPrompt);
    // Should not match commit-message due to maxPromptLength guard
    assert.notEqual(result.task, OFFLOAD_TASK.COMMIT_MESSAGE);
  });
});

// ── meetsOffloadThreshold ──────────────────────────────────

describe('meetsOffloadThreshold', () => {
  it('passes when confidence exceeds threshold', () => {
    const classification = {
      task: OFFLOAD_TASK.COMMIT_MESSAGE as const,
      confidence: 0.95,
      shouldOffload: true,
      reason: 'test',
    };
    assert.equal(meetsOffloadThreshold(classification, 0.7), true);
  });

  it('fails when confidence below threshold', () => {
    const classification = {
      task: OFFLOAD_TASK.SUMMARIZATION as const,
      confidence: 0.5,
      shouldOffload: true,
      reason: 'test',
    };
    assert.equal(meetsOffloadThreshold(classification, 0.7), false);
  });

  it('fails when shouldOffload is false regardless of confidence', () => {
    const classification = {
      task: OFFLOAD_TASK.NOT_OFFLOADABLE as const,
      confidence: 0.95,
      shouldOffload: false,
      reason: 'test',
    };
    assert.equal(meetsOffloadThreshold(classification, 0.7), false);
  });

  it('passes at exact threshold', () => {
    const classification = {
      task: OFFLOAD_TASK.BOILERPLATE as const,
      confidence: 0.7,
      shouldOffload: true,
      reason: 'test',
    };
    assert.equal(meetsOffloadThreshold(classification, 0.7), true);
  });
});
