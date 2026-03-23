/**
 * Tests for the OpenAI Responses API inbound transformer.
 *
 * Covers detection (positive + negative), string input, array input,
 * instructions, tools, and edge cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { openaiResponsesInbound } from '../../../src/transformers/inbound/openai-responses.js';

// ── Detection ───────────────────────────────────────────────

describe('openaiResponsesInbound.detect()', () => {
  it('returns true for string input with model', () => {
    assert.equal(
      openaiResponsesInbound.detect({ model: 'gpt-4o', input: 'Hello' }),
      true,
    );
  });

  it('returns true for array input with model', () => {
    assert.equal(
      openaiResponsesInbound.detect({
        model: 'gpt-4o',
        input: [{ role: 'user', content: 'Hello' }],
      }),
      true,
    );
  });

  it('returns false when input is missing', () => {
    assert.equal(openaiResponsesInbound.detect({ model: 'gpt-4o' }), false);
  });

  it('returns false when model is missing', () => {
    assert.equal(openaiResponsesInbound.detect({ input: 'Hello' }), false);
  });

  it('returns false when messages is present (Chat format)', () => {
    assert.equal(
      openaiResponsesInbound.detect({
        model: 'gpt-4o',
        input: 'Hello',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      false,
    );
  });

  it('returns false for non-object input', () => {
    assert.equal(openaiResponsesInbound.detect('string'), false);
    assert.equal(openaiResponsesInbound.detect(null), false);
    assert.equal(openaiResponsesInbound.detect(42), false);
    assert.equal(openaiResponsesInbound.detect(undefined), false);
  });

  it('returns false when input is not string or array', () => {
    assert.equal(
      openaiResponsesInbound.detect({ model: 'gpt-4o', input: 123 }),
      false,
    );
  });
});

// ── String input transformation ─────────────────────────────

describe('openaiResponsesInbound.transformRequest() — string input', () => {
  it('transforms a string input into a single user message', () => {
    const raw = { model: 'gpt-4o', input: 'Hello world' };
    const result = openaiResponsesInbound.transformRequest(raw);

    assert.equal(result.model, 'gpt-4o');
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, 'Hello world');
  });

  it('prepends instructions as system message', () => {
    const raw = {
      model: 'gpt-4o',
      input: 'Hello',
      instructions: 'You are a helpful assistant.',
    };
    const result = openaiResponsesInbound.transformRequest(raw);

    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0]?.role, 'system');
    assert.equal(result.messages[0]?.content, 'You are a helpful assistant.');
    assert.equal(result.messages[1]?.role, 'user');
    assert.equal(result.messages[1]?.content, 'Hello');
  });
});

// ── Array input transformation ──────────────────────────────

describe('openaiResponsesInbound.transformRequest() — array input', () => {
  it('transforms an array of message items', () => {
    const raw = {
      model: 'gpt-4o',
      input: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    };

    const result = openaiResponsesInbound.transformRequest(raw);
    assert.equal(result.messages.length, 3);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, 'first');
    assert.equal(result.messages[2]?.content, 'third');
  });

  it('handles input items with type: "message" wrapper', () => {
    const raw = {
      model: 'gpt-4o',
      input: [
        { type: 'message', role: 'user', content: 'hello' },
      ],
    };

    const result = openaiResponsesInbound.transformRequest(raw);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, 'hello');
  });

  it('handles content blocks with input_text type', () => {
    const raw = {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'describe this' }],
        },
      ],
    };

    const result = openaiResponsesInbound.transformRequest(raw);
    const content = result.messages[0]?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0]?.type, 'text');
    if (content[0]?.type === 'text') {
      assert.equal(content[0].text, 'describe this');
    }
  });

  it('handles content blocks with input_image type', () => {
    const raw = {
      model: 'gpt-4o',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is this?' },
            { type: 'input_image', image_url: { url: 'https://example.com/img.png', detail: 'high' } },
          ],
        },
      ],
    };

    const result = openaiResponsesInbound.transformRequest(raw);
    const content = result.messages[0]?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content.length, 2);
    assert.equal(content[1]?.type, 'image_url');
    if (content[1]?.type === 'image_url') {
      assert.equal(content[1].image_url.url, 'https://example.com/img.png');
      assert.equal(content[1].image_url.detail, 'high');
    }
  });
});

// ── Parameters mapping ──────────────────────────────────────

describe('openaiResponsesInbound.transformRequest() — parameters', () => {
  it('maps temperature, max_output_tokens, top_p', () => {
    const raw = {
      model: 'gpt-4o',
      input: 'test',
      temperature: 0.7,
      max_output_tokens: 1024,
      top_p: 0.9,
    };

    const result = openaiResponsesInbound.transformRequest(raw);
    assert.equal(result.temperature, 0.7);
    assert.equal(result.maxTokens, 1024);
    assert.equal(result.topP, 0.9);
  });

  it('omits optional fields when not present', () => {
    const raw = { model: 'gpt-4o', input: 'hi' };
    const result = openaiResponsesInbound.transformRequest(raw);

    assert.equal(result.temperature, undefined);
    assert.equal(result.maxTokens, undefined);
    assert.equal(result.topP, undefined);
    assert.equal(result.tools, undefined);
    assert.equal(result.toolChoice, undefined);
  });
});

// ── Tools ───────────────────────────────────────────────────

describe('openaiResponsesInbound.transformRequest() — tools', () => {
  it('transforms function tool definitions', () => {
    const raw = {
      model: 'gpt-4o',
      input: 'What is the weather?',
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      ],
      tool_choice: 'auto',
    };

    const result = openaiResponsesInbound.transformRequest(raw);
    assert.equal(result.tools?.length, 1);
    assert.equal(result.tools?.[0]?.function.name, 'get_weather');
    assert.equal(result.tools?.[0]?.function.description, 'Get current weather');
    assert.ok(result.tools?.[0]?.function.parameters);
    assert.equal(result.toolChoice, 'auto');
  });

  it('handles nested function format (Chat-style tools)', () => {
    const raw = {
      model: 'gpt-4o',
      input: 'test',
      tools: [
        {
          type: 'function',
          function: {
            name: 'foo',
            description: 'bar',
            parameters: { type: 'object' },
          },
        },
      ],
    };

    const result = openaiResponsesInbound.transformRequest(raw);
    assert.equal(result.tools?.[0]?.function.name, 'foo');
  });
});

// ── Edge cases ──────────────────────────────────────────────

describe('openaiResponsesInbound.transformRequest() — edge cases', () => {
  it('throws TransformError for non-object input', () => {
    assert.throws(
      () => openaiResponsesInbound.transformRequest('not an object'),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError for empty input array', () => {
    assert.throws(
      () => openaiResponsesInbound.transformRequest({ model: 'gpt-4o', input: [] }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError for null input', () => {
    assert.throws(
      () => openaiResponsesInbound.transformRequest({ model: 'gpt-4o', input: null }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError for unsupported role in input item', () => {
    assert.throws(
      () =>
        openaiResponsesInbound.transformRequest({
          model: 'gpt-4o',
          input: [{ role: 'tool', content: 'hi' }],
        }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError for non-object input item', () => {
    assert.throws(
      () =>
        openaiResponsesInbound.transformRequest({
          model: 'gpt-4o',
          input: [42],
        }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });
});
