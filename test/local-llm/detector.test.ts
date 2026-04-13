/**
 * Local LLM detector tests — parameter parsing, model picking.
 *
 * Network-dependent probing is tested via mocked fetch in integration tests.
 * These unit tests cover the pure logic: parsing and selection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseParameterSize, pickBestLocalModel } from '../../src/local-llm/detector.js';
import type { DetectionResult, LocalModel } from '../../src/local-llm/types.js';

// ── parseParameterSize ──────────────────────────────────────

describe('parseParameterSize', () => {
  it('parses "7B" to 7', () => {
    assert.equal(parseParameterSize('7B'), 7);
  });

  it('parses "3.2b" to 3.2', () => {
    assert.equal(parseParameterSize('3.2b'), 3.2);
  });

  it('parses "70B" to 70', () => {
    assert.equal(parseParameterSize('70B'), 70);
  });

  it('returns undefined for empty string', () => {
    assert.equal(parseParameterSize(''), undefined);
  });

  it('returns undefined for non-matching string', () => {
    assert.equal(parseParameterSize('unknown'), undefined);
  });

  it('parses "1.5 B" with space', () => {
    assert.equal(parseParameterSize('1.5 B'), 1.5);
  });
});

// ── pickBestLocalModel ──────────────────────────────────────

describe('pickBestLocalModel', () => {
  const ollamaModel: LocalModel = {
    id: 'llama3.2:3b',
    name: 'llama3.2:3b',
    backend: 'ollama',
    parameterSize: 3.2,
    loaded: true,
  };

  const lmStudioModel: LocalModel = {
    id: 'codellama-7b',
    name: 'codellama-7b',
    backend: 'lm-studio',
    loaded: true,
  };

  const connectedOllama: DetectionResult = {
    backend: 'ollama',
    status: 'connected',
    baseUrl: 'http://localhost:11434',
    models: [ollamaModel],
  };

  const connectedLMStudio: DetectionResult = {
    backend: 'lm-studio',
    status: 'connected',
    baseUrl: 'http://localhost:1234',
    models: [lmStudioModel],
  };

  const disconnected: DetectionResult = {
    backend: 'ollama',
    status: 'disconnected',
    baseUrl: 'http://localhost:11434',
    models: [],
  };

  it('returns null when no backends connected', () => {
    assert.equal(pickBestLocalModel([disconnected]), null);
  });

  it('returns null for empty results', () => {
    assert.equal(pickBestLocalModel([]), null);
  });

  it('picks first model from first connected backend', () => {
    const result = pickBestLocalModel([connectedOllama, connectedLMStudio]);
    assert.equal(result?.id, 'llama3.2:3b');
  });

  it('finds preferred model across backends', () => {
    const result = pickBestLocalModel(
      [connectedOllama, connectedLMStudio],
      'codellama-7b',
    );
    assert.equal(result?.id, 'codellama-7b');
    assert.equal(result?.backend, 'lm-studio');
  });

  it('falls back to first model when preferred not found', () => {
    const result = pickBestLocalModel([connectedOllama], 'nonexistent-model');
    assert.equal(result?.id, 'llama3.2:3b');
  });

  it('skips connected backends with no models', () => {
    const emptyConnected: DetectionResult = {
      backend: 'ollama',
      status: 'connected',
      baseUrl: 'http://localhost:11434',
      models: [],
    };
    const result = pickBestLocalModel([emptyConnected, connectedLMStudio]);
    assert.equal(result?.id, 'codellama-7b');
  });
});
