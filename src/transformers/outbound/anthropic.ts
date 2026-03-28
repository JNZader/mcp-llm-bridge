/**
 * Outbound transformer for Anthropic Messages API format.
 *
 * Converts InternalLLMRequest → Anthropic request body,
 * and Anthropic response → InternalLLMResponse.
 */

import type { OutboundTransformer } from '../../core/transformer.js';
import { TransformError } from '../../core/transformer.js';
import type {
  InternalLLMRequest,
  InternalLLMResponse,
  InternalMessage,
} from '../../core/internal-model.js';

// ── Helpers ─────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── Request transformation ──────────────────────────────────

function messageToAnthropic(msg: InternalMessage): Record<string, unknown> | null {
  // System messages are handled at the top level, skip them
  if (msg.role === 'system') return null;

  // Tool messages → user message with tool_result content block
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: msg.toolCallId ?? '',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
        },
      ],
    };
  }

  const result: Record<string, unknown> = { role: msg.role };

  // Build content blocks
  const contentBlocks: Record<string, unknown>[] = [];

  if (msg.content !== undefined) {
    if (typeof msg.content === 'string') {
      contentBlocks.push({ type: 'text', text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          contentBlocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          // Convert data URI to base64 source, URL to url source
          const url = part.image_url.url;
          if (url.startsWith('data:')) {
            const match = /^data:([^;]+);base64,(.+)$/.exec(url);
            if (match) {
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: match[1],
                  data: match[2],
                },
              });
            }
          } else {
            contentBlocks.push({
              type: 'image',
              source: { type: 'url', url },
            });
          }
        }
      }
    }
  }

  // Add tool_use blocks for assistant messages with tool calls
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      let input: unknown;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = tc.function.arguments;
      }
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // Use string content if it's just one text block, otherwise array
  if (contentBlocks.length === 1 && contentBlocks[0]?.['type'] === 'text') {
    result['content'] = contentBlocks[0]['text'];
  } else if (contentBlocks.length > 0) {
    result['content'] = contentBlocks;
  }

  return result;
}

function extractSystemMessage(messages: readonly InternalMessage[]): string | undefined {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  if (systemMsgs.length === 0) return undefined;

  return systemMsgs
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

// ── Response transformation ─────────────────────────────────

function mapStopReason(reason: string | undefined | null): InternalLLMResponse['finishReason'] {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'stop_sequence': return 'stop';
    case 'max_tokens': return 'length';
    case 'tool_use': return 'tool_calls';
    default: return 'stop';
  }
}

// ── Transformer ─────────────────────────────────────────────

export const anthropicOutbound: OutboundTransformer = {
  name: 'anthropic',

  transformRequest(internal: InternalLLMRequest): unknown {
    const body: Record<string, unknown> = {};

    if (internal.model) body['model'] = internal.model;
    body['max_tokens'] = internal.maxTokens ?? 4096;

    // Extract system message
    const system = extractSystemMessage(internal.messages);
    if (system) body['system'] = system;

    // Map non-system messages
    const messages = internal.messages
      .map(messageToAnthropic)
      .filter((m): m is Record<string, unknown> => m !== null);
    body['messages'] = messages;

    if (internal.temperature !== undefined) body['temperature'] = internal.temperature;
    if (internal.topP !== undefined) body['top_p'] = internal.topP;
    if (internal.stop) body['stop_sequences'] = Array.isArray(internal.stop) ? internal.stop : [internal.stop];

    if (internal.tools && internal.tools.length > 0) {
      body['tools'] = internal.tools.map((t) => ({
        name: t.function.name,
        ...(t.function.description ? { description: t.function.description } : {}),
        ...(t.function.parameters ? { input_schema: t.function.parameters } : {}),
      }));
    }

    if (internal.toolChoice !== undefined) {
      if (typeof internal.toolChoice === 'string') {
        switch (internal.toolChoice) {
          case 'auto': body['tool_choice'] = { type: 'auto' }; break;
          case 'required': body['tool_choice'] = { type: 'any' }; break;
          case 'none': body['tool_choice'] = { type: 'none' }; break;
        }
      } else {
        body['tool_choice'] = { type: 'tool', name: internal.toolChoice.function.name };
      }
    }

    return body;
  },

  transformResponse(providerResponse: unknown): InternalLLMResponse {
    if (!isObject(providerResponse)) {
      throw new TransformError('Response must be an object', 'anthropic');
    }

    const contentBlocks = providerResponse['content'];
    let content = '';
    if (Array.isArray(contentBlocks)) {
      content = contentBlocks
        .filter((b) => isObject(b) && b['type'] === 'text')
        .map((b) => (b as Record<string, unknown>)['text'] as string)
        .join('');
    }

    const usage = isObject(providerResponse['usage']) ? providerResponse['usage'] : {};
    const inputTokens = typeof usage['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
    const outputTokens = typeof usage['output_tokens'] === 'number' ? usage['output_tokens'] : 0;

    const response: InternalLLMResponse = {
      content,
      model: typeof providerResponse['model'] === 'string' ? providerResponse['model'] : '',
      finishReason: mapStopReason(providerResponse['stop_reason'] as string | undefined),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };

    // Map tool_use blocks to toolCalls
    if (Array.isArray(contentBlocks)) {
      const toolCalls = contentBlocks
        .filter((b) => isObject(b) && b['type'] === 'tool_use')
        .map((b) => {
          const block = b as Record<string, unknown>;
          return {
            id: String(block['id'] ?? ''),
            type: 'function' as const,
            function: {
              name: String(block['name'] ?? ''),
              arguments: typeof block['input'] === 'string'
                ? block['input']
                : JSON.stringify(block['input'] ?? {}),
            },
          };
        });
      if (toolCalls.length > 0) {
        response.toolCalls = toolCalls;
      }
    }

    return response;
  },
};
