/**
 * Model name resolver tests — HF ID resolution, capability inference, task recommendations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveHFModelId,
  inferCapabilities,
  recommendTasks,
} from '../../src/model-discovery/resolver.js';

// ── resolveHFModelId ──────────────────────────────────────

describe('resolveHFModelId', () => {
  it('resolves Ollama llama3.2:3b', () => {
    assert.equal(resolveHFModelId('llama3.2:3b'), 'meta-llama/Llama-3.2-3B');
  });

  it('resolves Ollama llama3.2:1b', () => {
    assert.equal(resolveHFModelId('llama3.2:1b'), 'meta-llama/Llama-3.2-1B');
  });

  it('resolves codellama:7b', () => {
    assert.equal(resolveHFModelId('codellama:7b'), 'codellama/CodeLlama-7b-hf');
  });

  it('resolves codellama:7b-instruct variant', () => {
    assert.equal(resolveHFModelId('codellama:7b-instruct'), 'codellama/CodeLlama-7b-hf');
  });

  it('resolves mistral:7b', () => {
    assert.equal(resolveHFModelId('mistral:7b'), 'mistralai/Mistral-7B-v0.3');
  });

  it('resolves gemma2:9b', () => {
    assert.equal(resolveHFModelId('gemma2:9b'), 'google/gemma-2-9b');
  });

  it('resolves phi3:mini', () => {
    assert.equal(resolveHFModelId('phi3:mini'), 'microsoft/Phi-3-mini-4k-instruct');
  });

  it('resolves qwen2.5:7b', () => {
    assert.equal(resolveHFModelId('qwen2.5:7b'), 'Qwen/Qwen2.5-7B');
  });

  it('resolves starcoder2:3b', () => {
    assert.equal(resolveHFModelId('starcoder2:3b'), 'bigcode/starcoder2-3b');
  });

  it('resolves deepseek-coder:6.7b', () => {
    assert.equal(resolveHFModelId('deepseek-coder:6.7b'), 'deepseek-ai/deepseek-coder-6.7b-base');
  });

  it('returns null for unknown model', () => {
    assert.equal(resolveHFModelId('my-custom-model:latest'), null);
  });

  it('is case-insensitive', () => {
    assert.equal(resolveHFModelId('LLAMA3.2:3B'), 'meta-llama/Llama-3.2-3B');
  });

  it('handles LM Studio naming (hyphenated)', () => {
    assert.equal(resolveHFModelId('llama-3.2-3b-instruct-GGUF'), 'meta-llama/Llama-3.2-3B');
  });
});

// ── inferCapabilities ──────────────────────────────────────

describe('inferCapabilities', () => {
  it('infers chat from text-generation pipeline', () => {
    const caps = inferCapabilities([], 'text-generation');
    assert.ok(caps.includes('chat'));
  });

  it('infers embedding from feature-extraction pipeline', () => {
    const caps = inferCapabilities([], 'feature-extraction');
    assert.ok(caps.includes('embedding'));
  });

  it('infers code from tags', () => {
    const caps = inferCapabilities(['code', 'python'], 'text-generation');
    assert.ok(caps.includes('code'));
  });

  it('infers reasoning from tags', () => {
    const caps = inferCapabilities(['reasoning', 'math']);
    assert.ok(caps.includes('reasoning'));
  });

  it('deduplicates capabilities', () => {
    const caps = inferCapabilities(['conversational'], 'text-generation');
    const chatCount = caps.filter((c) => c === 'chat').length;
    assert.equal(chatCount, 1);
  });

  it('returns empty for no signals', () => {
    const caps = inferCapabilities([]);
    assert.equal(caps.length, 0);
  });
});

// ── recommendTasks ──────────────────────────────────────

describe('recommendTasks', () => {
  it('recommends commit-message for chat-capable models', () => {
    const tasks = recommendTasks(['chat']);
    assert.ok(tasks.includes('commit-message'));
  });

  it('recommends boilerplate for code-capable models', () => {
    const tasks = recommendTasks(['code']);
    assert.ok(tasks.includes('boilerplate'));
  });

  it('recommends format-conversion for code-capable models', () => {
    const tasks = recommendTasks(['code']);
    assert.ok(tasks.includes('format-conversion'));
  });

  it('recommends boilerplate for small chat models', () => {
    const tasks = recommendTasks(['chat'], 3);
    assert.ok(tasks.includes('boilerplate'));
  });

  it('does not recommend boilerplate for large chat-only models', () => {
    const tasks = recommendTasks(['chat'], 70);
    assert.ok(!tasks.includes('boilerplate'));
  });

  it('deduplicates task recommendations', () => {
    const tasks = recommendTasks(['chat', 'code'], 3);
    const boilerplateCount = tasks.filter((t) => t === 'boilerplate').length;
    assert.equal(boilerplateCount, 1);
  });

  it('returns empty for no capabilities', () => {
    const tasks = recommendTasks([]);
    assert.equal(tasks.length, 0);
  });
});
