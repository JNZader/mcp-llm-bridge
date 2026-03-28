/**
 * Tests for the OpenAI outbound transformer.
 *
 * Covers request transformation (messages, tools, parameters)
 * and response transformation (content, usage, tool_calls, finish_reason).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { openaiOutbound } from '../../../src/transformers/outbound/openai.js';
import type { InternalLLMRequest } from '../../../src/core/internal-model.js';

// ── Request transformation ──────────────────────────────────

describe('openaiOutbound.transformRequest()', () => {
  it('transforms a basic request with string content', () => {
    const internal: InternalLLMRequest = {
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;

    assert.equal(result['model'], 'gpt-4o');
    assert.equal(result['temperature'], 0.7);
    assert.equal(result['max_tokens'], 1024);

    const messages = result['messages'] as Record<string, unknown>[];
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.['role'], 'system');
    assert.equal(messages[0]?.['content'], 'Be helpful.');
    assert.equal(messages[1]?.['role'], 'user');
    assert.equal(messages[1]?.['content'], 'Hello');
  });

  it('maps content parts array correctly', () => {
    const internal: InternalLLMRequest = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png', detail: 'high' } },
          ],
        },
      ],
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
    const messages = result['messages'] as Record<string, unknown>[];
    const content = messages[0]?.['content'] as Record<string, unknown>[];

    assert.equal(content.length, 2);
    assert.equal(content[0]?.['type'], 'text');
    assert.equal(content[0]?.['text'], 'What is this?');
    assert.equal(content[1]?.['type'], 'image_url');
  });

  it('maps tool calls in assistant messages', () => {
    const internal: InternalLLMRequest = {
      messages: [
        {
          role: 'assistant',
          toolCalls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
            },
          ],
        },
      ],
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
    const messages = result['messages'] as Record<string, unknown>[];
    const toolCalls = messages[0]?.['tool_calls'] as Record<string, unknown>[];

    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]?.['id'], 'call_123');
  });

  it('maps tool message with tool_call_id', () => {
    const internal: InternalLLMRequest = {
      messages: [
        { role: 'tool', content: '{"temp":72}', toolCallId: 'call_123' },
      ],
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
    const messages = result['messages'] as Record<string, unknown>[];
    assert.equal(messages[0]?.['tool_call_id'], 'call_123');
    assert.equal(messages[0]?.['content'], '{"temp":72}');
  });

  it('maps tools and tool_choice', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object' },
          },
        },
      ],
      toolChoice: 'auto',
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
    const tools = result['tools'] as Record<string, unknown>[];
    assert.equal(tools.length, 1);
    assert.equal(result['tool_choice'], 'auto');
  });

  it('maps specific function tool_choice', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
      toolChoice: { type: 'function', function: { name: 'get_weather' } },
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
    const toolChoice = result['tool_choice'] as Record<string, unknown>;
    assert.equal(toolChoice['type'], 'function');
  });

  it('maps top_p and stop', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
      topP: 0.9,
      stop: ['END'],
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
    assert.equal(result['top_p'], 0.9);
    assert.deepEqual(result['stop'], ['END']);
  });

  it('omits undefined optional fields', () => {
    const internal: InternalLLMRequest = {
      messages: [{ role: 'user', content: 'test' }],
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
    assert.equal(result['model'], undefined);
    assert.equal(result['temperature'], undefined);
    assert.equal(result['max_tokens'], undefined);
    assert.equal(result['tools'], undefined);
  });

  it('sets content to null when message content is undefined', () => {
    const internal: InternalLLMRequest = {
      messages: [
        {
          role: 'assistant',
          toolCalls: [
            { id: 'tc1', type: 'function', function: { name: 'foo', arguments: '{}' } },
          ],
        },
      ],
    };

    const result = openaiOutbound.transformRequest(internal) as Record<string, unknown>;
    const messages = result['messages'] as Record<string, unknown>[];
    assert.equal(messages[0]?.['content'], null);
  });
});

// ── Response transformation ─────────────────────────────────

describe('openaiOutbound.transformResponse()', () => {
  it('transforms a standard completion response', () => {
    const raw = {
      id: 'chatcmpl-abc',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello there!' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    const result = openaiOutbound.transformResponse(raw);

    assert.equal(result.content, 'Hello there!');
    assert.equal(result.model, 'gpt-4o');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 5);
    assert.equal(result.usage.totalTokens, 15);
  });

  it('maps finish_reason "length" correctly', () => {
    const raw = {
      model: 'gpt-4o',
      choices: [{ message: { content: 'truncated' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 10, completion_tokens: 100 },
    };

    const result = openaiOutbound.transformResponse(raw);
    assert.equal(result.finishReason, 'length');
  });

  it('maps finish_reason "tool_calls" correctly', () => {
    const raw = {
      model: 'gpt-4o',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"loc":"NYC"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };

    const result = openaiOutbound.transformResponse(raw);
    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls?.[0]?.id, 'call_123');
    assert.equal(result.toolCalls?.[0]?.function.name, 'get_weather');
  });

  it('defaults to 0 when usage is missing', () => {
    const raw = {
      model: 'gpt-4o',
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
    };

    const result = openaiOutbound.transformResponse(raw);
    assert.equal(result.usage.inputTokens, 0);
    assert.equal(result.usage.outputTokens, 0);
    assert.equal(result.usage.totalTokens, 0);
  });

  it('throws TransformError for non-object response', () => {
    assert.throws(
      () => openaiOutbound.transformResponse('not an object'),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('throws TransformError when choices is empty', () => {
    assert.throws(
      () => openaiOutbound.transformResponse({ model: 'gpt-4o', choices: [] }),
      (err: unknown) => err instanceof Error && err.name === 'TransformError',
    );
  });

  it('handles empty content string', () => {
    const raw = {
      model: 'gpt-4o',
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };

    const result = openaiOutbound.transformResponse(raw);
    assert.equal(result.content, '');
  });
});
