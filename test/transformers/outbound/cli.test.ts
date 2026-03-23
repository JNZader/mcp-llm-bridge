/**
 * Tests for the CLI outbound transformer.
 *
 * Covers request transformation (message flattening, system extraction)
 * and response transformation (string, object, error cases).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { cliOutbound } from '../../../src/transformers/outbound/cli.js';
import { TransformError } from '../../../src/core/transformer.js';
import type { InternalLLMRequest } from '../../../src/core/internal-model.js';

// ── Request transformation ──────────────────────────────────

describe('cliOutbound.transformRequest()', () => {
  it('transforms a basic user message into a prompt', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'Hello world' }],
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['prompt'], 'Hello world');
    assert.equal(result['system'], undefined);
  });

  it('extracts system message separately', () => {
    const internal: InternalLLMRequest = {
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'What is 2+2?' },
      ],
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['prompt'], 'What is 2+2?');
    assert.equal(result['system'], 'Be concise.');
  });

  it('concatenates multiple system messages', () => {
    const internal: InternalLLMRequest = {
      messages: [
        { role: 'system', content: 'Rule one.' },
        { role: 'system', content: 'Rule two.' },
        { role: 'user', content: 'Go' },
      ],
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['system'], 'Rule one.\nRule two.');
    assert.equal(result['prompt'], 'Go');
  });

  it('flattens multi-turn conversation into a single prompt', () => {
    const internal: InternalLLMRequest = {
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Follow up' },
      ],
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['prompt'], 'First question\nFirst answer\nFollow up');
  });

  it('includes model when specified', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'claude-sonnet-4-20250514',
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['model'], 'claude-sonnet-4-20250514');
  });

  it('includes maxTokens and temperature when specified', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 2048,
      temperature: 0.5,
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['maxTokens'], 2048);
    assert.equal(result['temperature'], 0.5);
  });

  it('omits optional fields when not present', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['model'], undefined);
    assert.equal(result['maxTokens'], undefined);
    assert.equal(result['temperature'], undefined);
    assert.equal(result['system'], undefined);
  });

  it('handles content parts array by extracting text', () => {
    const internal: InternalLLMRequest = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
          ],
        },
      ],
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    // CLI can't handle images, but should extract the text part
    assert.equal(result['prompt'], 'Describe this');
  });

  it('throws TransformError for empty messages', () => {
    const internal: InternalLLMRequest = {
      messages: [],
    };

    // Zod would normally catch this but the transformer should also guard
    assert.throws(
      () => cliOutbound.transformRequest(internal),
      (err: Error) => err instanceof TransformError,
    );
  });

  it('uses system as prompt when only system messages exist', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'system', content: 'You are a calculator' }],
    };

    const result = cliOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['prompt'], 'You are a calculator');
    assert.equal(result['system'], 'You are a calculator');
  });
});

// ── Response transformation ─────────────────────────────────

describe('cliOutbound.transformResponse()', () => {
  it('transforms a plain string response', () => {
    const result = cliOutbound.transformResponse('Hello from CLI');

    assert.equal(result.content, 'Hello from CLI');
    assert.equal(result.model, 'cli-unknown');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.inputTokens, 0);
    assert.equal(result.usage.outputTokens, 0);
    assert.equal(result.usage.totalTokens, 0);
  });

  it('transforms an object response with text field', () => {
    const result = cliOutbound.transformResponse({
      text: 'Response text',
      model: 'claude-cli',
    });

    assert.equal(result.content, 'Response text');
    assert.equal(result.model, 'claude-cli');
    assert.equal(result.finishReason, 'stop');
  });

  it('uses cli-unknown model when object has no model field', () => {
    const result = cliOutbound.transformResponse({
      text: 'Some response',
    });

    assert.equal(result.model, 'cli-unknown');
  });

  it('throws TransformError for object without text field', () => {
    assert.throws(
      () => cliOutbound.transformResponse({ data: 'wrong' }),
      (err: Error) => err instanceof TransformError,
    );
  });

  it('throws TransformError for non-string non-object response', () => {
    assert.throws(
      () => cliOutbound.transformResponse(42),
      (err: Error) => err instanceof TransformError,
    );
  });

  it('throws TransformError for null response', () => {
    assert.throws(
      () => cliOutbound.transformResponse(null),
      (err: Error) => err instanceof TransformError,
    );
  });

  it('throws TransformError for array response', () => {
    assert.throws(
      () => cliOutbound.transformResponse(['a', 'b']),
      (err: Error) => err instanceof TransformError,
    );
  });

  it('always returns zero usage for CLI responses', () => {
    const result = cliOutbound.transformResponse('any text');

    assert.deepEqual(result.usage, {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });
});
