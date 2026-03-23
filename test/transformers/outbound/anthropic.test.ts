/**
 * Tests for the Anthropic outbound transformer.
 *
 * Covers request transformation (system extraction, content blocks,
 * tool_use, tool_result) and response transformation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { anthropicOutbound } from '../../../src/transformers/outbound/anthropic.js';
import type { InternalLLMRequest } from '../../../src/core/internal-model.js';

// ── Request transformation ──────────────────────────────────

describe('anthropicOutbound.transformRequest()', () => {
  it('extracts system message to top-level field', () => {
    const internal: InternalLLMRequest = {
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      model: 'claude-sonnet-4-20250514',
      maxTokens: 1024,
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['model'], 'claude-sonnet-4-20250514');
    assert.equal(result['max_tokens'], 1024);
    assert.equal(result['system'], 'Be helpful.');

    const messages = result['messages'] as Record<string, unknown>[];
    // System message should NOT be in the messages array
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.['role'], 'user');
    assert.equal(messages[0]?.['content'], 'Hello');
  });

  it('defaults max_tokens to 4096 when not specified', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    assert.equal(result['max_tokens'], 4096);
  });

  it('maps temperature, top_p, stop as stop_sequences', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
      temperature: 0.7,
      topP: 0.9,
      stop: ['\n\nHuman:'],
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    assert.equal(result['temperature'], 0.7);
    assert.equal(result['top_p'], 0.9);
    assert.deepEqual(result['stop_sequences'], ['\n\nHuman:']);
  });

  it('wraps single stop string in array for stop_sequences', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
      stop: 'END',
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    assert.deepEqual(result['stop_sequences'], ['END']);
  });

  it('maps tool message to user message with tool_result block', () => {
    const internal: InternalLLMRequest = {
      messages: [
        { role: 'tool', content: '{"temp":72}', toolCallId: 'toolu_123' },
      ],
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    const messages = result['messages'] as Record<string, unknown>[];
    assert.equal(messages[0]?.['role'], 'user');

    const content = messages[0]?.['content'] as Record<string, unknown>[];
    assert.equal(content[0]?.['type'], 'tool_result');
    assert.equal(content[0]?.['tool_use_id'], 'toolu_123');
    assert.equal(content[0]?.['content'], '{"temp":72}');
  });

  it('maps assistant message with toolCalls to tool_use blocks', () => {
    const internal: InternalLLMRequest = {
      messages: [
        {
          role: 'assistant',
          content: 'Let me check.',
          toolCalls: [
            {
              id: 'toolu_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
            },
          ],
        },
      ],
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    const messages = result['messages'] as Record<string, unknown>[];
    const content = messages[0]?.['content'] as Record<string, unknown>[];

    // Should have text block + tool_use block
    assert.equal(content.length, 2);
    assert.equal(content[0]?.['type'], 'text');
    assert.equal(content[0]?.['text'], 'Let me check.');
    assert.equal(content[1]?.['type'], 'tool_use');
    assert.equal(content[1]?.['id'], 'toolu_123');
    assert.equal(content[1]?.['name'], 'get_weather');
    assert.deepEqual(content[1]?.['input'], { location: 'NYC' });
  });

  it('maps tools with input_schema format', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { loc: { type: 'string' } } },
          },
        },
      ],
      toolChoice: 'auto',
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    const tools = result['tools'] as Record<string, unknown>[];
    assert.equal(tools[0]?.['name'], 'get_weather');
    assert.equal(tools[0]?.['description'], 'Get weather');
    assert.ok(tools[0]?.['input_schema']);

    const toolChoice = result['tool_choice'] as Record<string, unknown>;
    assert.equal(toolChoice['type'], 'auto');
  });

  it('maps toolChoice "required" to { type: "any" }', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
      toolChoice: 'required',
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    const toolChoice = result['tool_choice'] as Record<string, unknown>;
    assert.equal(toolChoice['type'], 'any');
  });

  it('maps specific function toolChoice to { type: "tool", name }', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
      toolChoice: { type: 'function', function: { name: 'get_weather' } },
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    const toolChoice = result['tool_choice'] as Record<string, unknown>;
    assert.equal(toolChoice['type'], 'tool');
    assert.equal(toolChoice['name'], 'get_weather');
  });

  it('converts data URI image to base64 source', () => {
    const internal: InternalLLMRequest = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
          ],
        },
      ],
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    const messages = result['messages'] as Record<string, unknown>[];
    const content = messages[0]?.['content'] as Record<string, unknown>[];
    assert.equal(content[0]?.['type'], 'image');
    const source = content[0]?.['source'] as Record<string, unknown>;
    assert.equal(source['type'], 'base64');
    assert.equal(source['media_type'], 'image/png');
    assert.equal(source['data'], 'abc123');
  });

  it('converts URL image to url source', () => {
    const internal: InternalLLMRequest = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
          ],
        },
      ],
    };

    const result = anthropicOutbound.transformRequest(internal) as Record<string, unknown>;
    const messages = result['messages'] as Record<string, unknown>[];
    const content = messages[0]?.['content'] as Record<string, unknown>[];
    const source = content[0]?.['source'] as Record<string, unknown>;
    assert.equal(source['type'], 'url');
    assert.equal(source['url'], 'https://example.com/img.png');
  });
});

// ── Response transformation ─────────────────────────────────

describe('anthropicOutbound.transformResponse()', () => {
  it('transforms a standard Anthropic response', () => {
    const raw = {
      id: 'msg_abc',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'Hello there!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    const result = anthropicOutbound.transformResponse(raw);

    assert.equal(result.content, 'Hello there!');
    assert.equal(result.model, 'claude-sonnet-4-20250514');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 5);
    assert.equal(result.usage.totalTokens, 15);
  });

  it('maps stop_reason "max_tokens" to "length"', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'truncated' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 100 },
    };

    const result = anthropicOutbound.transformResponse(raw);
    assert.equal(result.finishReason, 'length');
  });

  it('maps stop_reason "tool_use" to "tool_calls" and extracts tool calls', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      content: [
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'get_weather',
          input: { location: 'NYC' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 30 },
    };

    const result = anthropicOutbound.transformResponse(raw);
    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(result.content, 'Let me check.');
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls?.[0]?.id, 'toolu_123');
    assert.equal(result.toolCalls?.[0]?.function.name, 'get_weather');
    assert.equal(result.toolCalls?.[0]?.function.arguments, '{"location":"NYC"}');
  });

  it('defaults to 0 when usage is missing', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
    };

    const result = anthropicOutbound.transformResponse(raw);
    assert.equal(result.usage.inputTokens, 0);
    assert.equal(result.usage.outputTokens, 0);
  });

  it('throws TransformError for non-object response', () => {
    assert.throws(
      () => anthropicOutbound.transformResponse('not an object'),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('handles empty content array', () => {
    const raw = {
      model: 'claude-sonnet-4-20250514',
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    };

    const result = anthropicOutbound.transformResponse(raw);
    assert.equal(result.content, '');
  });
});
