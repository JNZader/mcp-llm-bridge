/**
 * Tests for the Anthropic Messages API inbound transformer.
 *
 * Covers detection, system message handling, content blocks,
 * tool_use/tool_result mapping, and edge cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { anthropicInbound } from '../../../src/transformers/inbound/anthropic.js';

// ── Detection ───────────────────────────────────────────────

describe('anthropicInbound.detect()', () => {
  it('returns true for valid Anthropic payload (messages + max_tokens)', () => {
    assert.equal(
      anthropicInbound.detect({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'hello' }],
      }),
      true,
    );
  });

  it('returns true even without model (max_tokens is the key differentiator)', () => {
    assert.equal(
      anthropicInbound.detect({
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'hello' }],
      }),
      true,
    );
  });

  it('returns false when max_tokens is missing (could be OpenAI)', () => {
    assert.equal(
      anthropicInbound.detect({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
      }),
      false,
    );
  });

  it('returns false when messages is missing', () => {
    assert.equal(
      anthropicInbound.detect({ max_tokens: 1024 }),
      false,
    );
  });

  it('returns false for non-object input', () => {
    assert.equal(anthropicInbound.detect('string'), false);
    assert.equal(anthropicInbound.detect(null), false);
    assert.equal(anthropicInbound.detect(42), false);
    assert.equal(anthropicInbound.detect(undefined), false);
  });

  it('returns false when max_tokens is not a number', () => {
    assert.equal(
      anthropicInbound.detect({
        max_tokens: '1024',
        messages: [{ role: 'user', content: 'hi' }],
      }),
      false,
    );
  });
});

// ── Simple message transformation ───────────────────────────

describe('anthropicInbound.transformRequest() — simple messages', () => {
  it('transforms a basic user message', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello world' }],
    };

    const result = anthropicInbound.transformRequest(raw);
    assert.equal(result.model, 'claude-sonnet-4-20250514');
    assert.equal(result.maxTokens, 1024);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, 'Hello world');
  });

  it('transforms multiple messages', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    };

    const result = anthropicInbound.transformRequest(raw);
    // No system message, so messages.length should be 3
    assert.equal(result.messages.length, 3);
    assert.equal(result.messages[2]?.content, 'third');
  });
});

// ── System message handling ─────────────────────────────────

describe('anthropicInbound.transformRequest() — system message', () => {
  it('converts top-level system string to system message', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const result = anthropicInbound.transformRequest(raw);
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0]?.role, 'system');
    assert.equal(result.messages[0]?.content, 'You are a helpful assistant.');
    assert.equal(result.messages[1]?.role, 'user');
  });

  it('converts top-level system array to system message with content parts', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: [{ type: 'text', text: 'Be concise.' }],
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const result = anthropicInbound.transformRequest(raw);
    assert.equal(result.messages[0]?.role, 'system');
    const content = result.messages[0]?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0]?.type, 'text');
    if (content[0]?.type === 'text') {
      assert.equal(content[0].text, 'Be concise.');
    }
  });
});

// ── Content blocks ──────────────────────────────────────────

describe('anthropicInbound.transformRequest() — content blocks', () => {
  it('handles content as array of text blocks', () => {
    const raw = {
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'describe this' }],
        },
      ],
    };

    const result = anthropicInbound.transformRequest(raw);
    const content = result.messages[0]?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0]?.type, 'text');
    if (content[0]?.type === 'text') {
      assert.equal(content[0].text, 'describe this');
    }
  });

  it('handles base64 image content blocks', () => {
    const raw = {
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
          ],
        },
      ],
    };

    const result = anthropicInbound.transformRequest(raw);
    const content = result.messages[0]?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content.length, 2);
    assert.equal(content[1]?.type, 'image_url');
    if (content[1]?.type === 'image_url') {
      assert.equal(content[1].image_url.url, 'data:image/png;base64,iVBORw0KGgo=');
    }
  });

  it('handles URL image content blocks', () => {
    const raw = {
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: 'https://example.com/img.png' },
            },
          ],
        },
      ],
    };

    const result = anthropicInbound.transformRequest(raw);
    const content = result.messages[0]?.content;
    assert.ok(Array.isArray(content));
    if (content[0]?.type === 'image_url') {
      assert.equal(content[0].image_url.url, 'https://example.com/img.png');
    }
  });
});

// ── Parameters mapping ──────────────────────────────────────

describe('anthropicInbound.transformRequest() — parameters', () => {
  it('maps temperature, top_p, stop_sequences', () => {
    const raw = {
      max_tokens: 2048,
      temperature: 0.7,
      top_p: 0.9,
      stop_sequences: ['\n\nHuman:'],
      messages: [{ role: 'user', content: 'test' }],
    };

    const result = anthropicInbound.transformRequest(raw);
    assert.equal(result.temperature, 0.7);
    assert.equal(result.topP, 0.9);
    assert.deepEqual(result.stop, ['\n\nHuman:']);
    assert.equal(result.maxTokens, 2048);
  });
});

// ── Tools ───────────────────────────────────────────────────

describe('anthropicInbound.transformRequest() — tools', () => {
  it('transforms Anthropic tool definitions (name, description, input_schema)', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Weather?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get current weather',
          input_schema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      ],
      tool_choice: { type: 'auto' },
    };

    const result = anthropicInbound.transformRequest(raw);
    assert.equal(result.tools?.length, 1);
    assert.equal(result.tools?.[0]?.function.name, 'get_weather');
    assert.equal(result.tools?.[0]?.function.description, 'Get current weather');
    assert.ok(result.tools?.[0]?.function.parameters);
    assert.equal(result.toolChoice, 'auto');
  });

  it('maps tool_choice { type: "any" } to "required"', () => {
    const raw = {
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'test' }],
      tool_choice: { type: 'any' },
    };

    const result = anthropicInbound.transformRequest(raw);
    assert.equal(result.toolChoice, 'required');
  });

  it('maps tool_choice { type: "tool", name: "foo" } to specific function', () => {
    const raw = {
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'test' }],
      tool_choice: { type: 'tool', name: 'get_weather' },
    };

    const result = anthropicInbound.transformRequest(raw);
    assert.deepEqual(result.toolChoice, {
      type: 'function',
      function: { name: 'get_weather' },
    });
  });
});

// ── Tool use / tool result ──────────────────────────────────

describe('anthropicInbound.transformRequest() — tool_use and tool_result', () => {
  it('maps assistant tool_use blocks to toolCalls', () => {
    const raw = {
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'Weather in NYC?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'get_weather',
              input: { location: 'NYC' },
            },
          ],
        },
      ],
    };

    const result = anthropicInbound.transformRequest(raw);
    const assistantMsg = result.messages[1];
    assert.equal(assistantMsg?.role, 'assistant');
    assert.equal(assistantMsg?.toolCalls?.length, 1);
    assert.equal(assistantMsg?.toolCalls?.[0]?.id, 'toolu_123');
    assert.equal(assistantMsg?.toolCalls?.[0]?.function.name, 'get_weather');
    assert.equal(assistantMsg?.toolCalls?.[0]?.function.arguments, '{"location":"NYC"}');

    // Text content should still be present (tool_use blocks are filtered out)
    const content = assistantMsg?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content.length, 1);
    assert.equal(content[0]?.type, 'text');
  });

  it('maps user tool_result blocks to tool messages', () => {
    const raw = {
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: '{"temp": 72}',
            },
          ],
        },
      ],
    };

    const result = anthropicInbound.transformRequest(raw);
    const toolMsg = result.messages[0];
    assert.equal(toolMsg?.role, 'tool');
    assert.equal(toolMsg?.toolCallId, 'toolu_123');
    assert.equal(toolMsg?.content, '{"temp": 72}');
  });
});

// ── Edge cases ──────────────────────────────────────────────

describe('anthropicInbound.transformRequest() — edge cases', () => {
  it('throws TransformError for non-object input', () => {
    assert.throws(
      () => anthropicInbound.transformRequest('not an object'),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError for empty messages array', () => {
    assert.throws(
      () => anthropicInbound.transformRequest({ max_tokens: 1024, messages: [] }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError for unsupported message role', () => {
    assert.throws(
      () =>
        anthropicInbound.transformRequest({
          max_tokens: 1024,
          messages: [{ role: 'system', content: 'hi' }],
        }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError for non-object message', () => {
    assert.throws(
      () =>
        anthropicInbound.transformRequest({
          max_tokens: 1024,
          messages: ['not an object'],
        }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });
});
