/**
 * Tests for the OpenAI Chat Completions inbound transformer.
 *
 * Covers detection (positive + negative), simple messages,
 * tools, system messages, and edge cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { openaiChatInbound } from '../../../src/transformers/inbound/openai-chat.js';

// ── Detection ───────────────────────────────────────────────

describe('openaiChatInbound.detect()', () => {
  it('returns true for valid OpenAI Chat payload', () => {
    const payload = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
    };
    assert.equal(openaiChatInbound.detect(payload), true);
  });

  it('returns false when messages is missing', () => {
    assert.equal(openaiChatInbound.detect({ model: 'gpt-4' }), false);
  });

  it('returns false when model is missing', () => {
    assert.equal(
      openaiChatInbound.detect({ messages: [{ role: 'user', content: 'hi' }] }),
      false,
    );
  });

  it('returns false for non-object input', () => {
    assert.equal(openaiChatInbound.detect('string'), false);
    assert.equal(openaiChatInbound.detect(null), false);
    assert.equal(openaiChatInbound.detect(42), false);
    assert.equal(openaiChatInbound.detect(undefined), false);
  });

  it('returns false when messages is not an array', () => {
    assert.equal(
      openaiChatInbound.detect({ model: 'gpt-4', messages: 'not-an-array' }),
      false,
    );
  });

  it('returns false when model is not a string', () => {
    assert.equal(
      openaiChatInbound.detect({ model: 123, messages: [] }),
      false,
    );
  });
});

// ── Simple message transformation ───────────────────────────

describe('openaiChatInbound.transformRequest() — simple messages', () => {
  it('transforms a basic user message', () => {
    const raw = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello world' }],
    };

    const result = openaiChatInbound.transformRequest(raw);

    assert.equal(result.model, 'gpt-4');
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, 'Hello world');
  });

  it('transforms multiple messages', () => {
    const raw = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    };

    const result = openaiChatInbound.transformRequest(raw);
    assert.equal(result.messages.length, 3);
    assert.equal(result.messages[2]?.content, 'third');
  });

  it('maps temperature, max_tokens, top_p, stop correctly', () => {
    const raw = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 0.9,
      stop: ['\n', 'END'],
    };

    const result = openaiChatInbound.transformRequest(raw);

    assert.equal(result.temperature, 0.7);
    assert.equal(result.maxTokens, 1024);
    assert.equal(result.topP, 0.9);
    assert.deepEqual(result.stop, ['\n', 'END']);
  });

  it('handles stop as a single string', () => {
    const raw = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
      stop: '\n',
    };

    const result = openaiChatInbound.transformRequest(raw);
    assert.equal(result.stop, '\n');
  });
});

// ── System messages ─────────────────────────────────────────

describe('openaiChatInbound.transformRequest() — system messages', () => {
  it('handles system role', () => {
    const raw = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hi' },
      ],
    };

    const result = openaiChatInbound.transformRequest(raw);
    assert.equal(result.messages[0]?.role, 'system');
    assert.equal(result.messages[0]?.content, 'You are a helpful assistant.');
  });
});

// ── Tools ───────────────────────────────────────────────────

describe('openaiChatInbound.transformRequest() — tools', () => {
  it('transforms tool definitions', () => {
    const raw = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'What is the weather?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        },
      ],
      tool_choice: 'auto',
    };

    const result = openaiChatInbound.transformRequest(raw);

    assert.equal(result.tools?.length, 1);
    assert.equal(result.tools?.[0]?.function.name, 'get_weather');
    assert.equal(result.tools?.[0]?.function.description, 'Get current weather');
    assert.ok(result.tools?.[0]?.function.parameters);
    assert.equal(result.toolChoice, 'auto');
  });

  it('transforms tool_choice as specific function', () => {
    const raw = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
      tool_choice: {
        type: 'function',
        function: { name: 'get_weather' },
      },
    };

    const result = openaiChatInbound.transformRequest(raw);
    assert.deepEqual(result.toolChoice, {
      type: 'function',
      function: { name: 'get_weather' },
    });
  });

  it('transforms assistant message with tool_calls', () => {
    const raw = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"NYC"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: '{"temp": 72}',
        },
      ],
    };

    const result = openaiChatInbound.transformRequest(raw);

    // assistant message with tool calls
    const assistantMsg = result.messages[1];
    assert.equal(assistantMsg?.role, 'assistant');
    assert.equal(assistantMsg?.toolCalls?.length, 1);
    assert.equal(assistantMsg?.toolCalls?.[0]?.id, 'call_123');
    assert.equal(assistantMsg?.toolCalls?.[0]?.function.name, 'get_weather');
    assert.equal(assistantMsg?.toolCalls?.[0]?.function.arguments, '{"location":"NYC"}');

    // tool response message
    const toolMsg = result.messages[2];
    assert.equal(toolMsg?.role, 'tool');
    assert.equal(toolMsg?.toolCallId, 'call_123');
    assert.equal(toolMsg?.content, '{"temp": 72}');
  });
});

// ── Content arrays ──────────────────────────────────────────

describe('openaiChatInbound.transformRequest() — content arrays', () => {
  it('handles content as array of text parts', () => {
    const raw = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'describe this' }],
        },
      ],
    };

    const result = openaiChatInbound.transformRequest(raw);
    const content = result.messages[0]?.content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0]?.type, 'text');
    if (content[0]?.type === 'text') {
      assert.equal(content[0].text, 'describe this');
    }
  });

  it('handles content with image_url parts', () => {
    const raw = {
      model: 'gpt-4-vision',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png', detail: 'high' } },
          ],
        },
      ],
    };

    const result = openaiChatInbound.transformRequest(raw);
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

// ── Edge cases ──────────────────────────────────────────────

describe('openaiChatInbound.transformRequest() — edge cases', () => {
  it('throws TransformError for non-object input', () => {
    assert.throws(
      () => openaiChatInbound.transformRequest('not an object'),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError for empty messages array', () => {
    assert.throws(
      () => openaiChatInbound.transformRequest({ model: 'gpt-4', messages: [] }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('omits optional fields when not present', () => {
    const raw = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    };

    const result = openaiChatInbound.transformRequest(raw);
    assert.equal(result.temperature, undefined);
    assert.equal(result.maxTokens, undefined);
    assert.equal(result.topP, undefined);
    assert.equal(result.stop, undefined);
    assert.equal(result.tools, undefined);
    assert.equal(result.toolChoice, undefined);
  });

  it('handles messages with null content (assistant tool-call messages)', () => {
    const raw = {
      model: 'gpt-4',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'tc_1',
              type: 'function',
              function: { name: 'foo', arguments: '{}' },
            },
          ],
        },
      ],
    };

    const result = openaiChatInbound.transformRequest(raw);
    assert.equal(result.messages[0]?.content, undefined);
    assert.equal(result.messages[0]?.toolCalls?.length, 1);
  });

  it('throws TransformError for unsupported role', () => {
    const raw = {
      model: 'gpt-4',
      messages: [{ role: 'developer', content: 'hi' }],
    };

    assert.throws(
      () => openaiChatInbound.transformRequest(raw),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });
});
