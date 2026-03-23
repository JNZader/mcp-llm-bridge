/**
 * Tests for the Google (Gemini) outbound transformer.
 *
 * Google uses OpenAI-compatible format, so the transformer delegates
 * to the OpenAI outbound transformer. We verify the delegation works
 * and the transformer is named correctly for registry lookup.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { googleOutbound } from '../../../src/transformers/outbound/google.js';
import type { InternalLLMRequest } from '../../../src/core/internal-model.js';

describe('googleOutbound', () => {
  it('has name "google"', () => {
    assert.equal(googleOutbound.name, 'google');
  });

  it('transforms request in OpenAI-compatible format', () => {
    const internal: InternalLLMRequest = {
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello' },
      ],
      model: 'gemini-2.5-flash',
      temperature: 0.5,
      maxTokens: 2048,
    };

    const result = googleOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['model'], 'gemini-2.5-flash');
    assert.equal(result['temperature'], 0.5);
    assert.equal(result['max_tokens'], 2048);

    const messages = result['messages'] as Record<string, unknown>[];
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.['role'], 'system');
  });

  it('transforms response in OpenAI-compatible format', () => {
    const raw = {
      model: 'gemini-2.5-flash',
      choices: [
        {
          message: { role: 'assistant', content: 'Hi from Gemini!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 4 },
    };

    const result = googleOutbound.transformResponse(raw);

    assert.equal(result.content, 'Hi from Gemini!');
    assert.equal(result.model, 'gemini-2.5-flash');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.inputTokens, 8);
    assert.equal(result.usage.outputTokens, 4);
    assert.equal(result.usage.totalTokens, 12);
  });
});
