/**
 * Outbound transformer for OpenAI Chat Completions format.
 *
 * Converts InternalLLMRequest → OpenAI-compatible request body,
 * and OpenAI-compatible response → InternalLLMResponse.
 *
 * Also used by Groq and OpenRouter (they speak OpenAI-compatible format).
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

function messageToOpenAI(msg: InternalMessage): Record<string, unknown> {
  const result: Record<string, unknown> = { role: msg.role };

  if (msg.content !== undefined) {
    if (typeof msg.content === 'string') {
      result['content'] = msg.content;
    } else if (Array.isArray(msg.content)) {
      result['content'] = msg.content.map((part) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        return {
          type: 'image_url',
          image_url: {
            url: part.image_url.url,
            ...(part.image_url.detail ? { detail: part.image_url.detail } : {}),
          },
        };
      });
    }
  } else {
    result['content'] = null;
  }

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    result['tool_calls'] = msg.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }

  if (msg.toolCallId) {
    result['tool_call_id'] = msg.toolCallId;
  }

  return result;
}

// ── Response transformation ─────────────────────────────────

function mapFinishReason(reason: string | undefined | null): InternalLLMResponse['finishReason'] {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': return 'tool_calls';
    case 'content_filter': return 'content_filter';
    default: return 'stop';
  }
}

// ── Transformer ─────────────────────────────────────────────

export const openaiOutbound: OutboundTransformer = {
  name: 'openai',

  transformRequest(internal: InternalLLMRequest): unknown {
    const body: Record<string, unknown> = {
      messages: internal.messages.map(messageToOpenAI),
    };

    if (internal.model) body['model'] = internal.model;
    if (internal.temperature !== undefined) body['temperature'] = internal.temperature;
    if (internal.maxTokens !== undefined) body['max_tokens'] = internal.maxTokens;
    if (internal.topP !== undefined) body['top_p'] = internal.topP;
    if (internal.stop !== undefined) body['stop'] = internal.stop;

    if (internal.tools && internal.tools.length > 0) {
      body['tools'] = internal.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.function.name,
          ...(t.function.description ? { description: t.function.description } : {}),
          ...(t.function.parameters ? { parameters: t.function.parameters } : {}),
        },
      }));
    }

    if (internal.toolChoice !== undefined) {
      if (typeof internal.toolChoice === 'string') {
        body['tool_choice'] = internal.toolChoice;
      } else {
        body['tool_choice'] = {
          type: 'function',
          function: { name: internal.toolChoice.function.name },
        };
      }
    }

    return body;
  },

  transformResponse(providerResponse: unknown): InternalLLMResponse {
    if (!isObject(providerResponse)) {
      throw new TransformError('Response must be an object', 'openai');
    }

    const choices = providerResponse['choices'];
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new TransformError('Response must have at least one choice', 'openai');
    }

    const choice = choices[0] as Record<string, unknown>;
    const message = choice['message'] as Record<string, unknown> | undefined;

    const content = typeof message?.['content'] === 'string'
      ? message['content']
      : '';

    const usage = isObject(providerResponse['usage']) ? providerResponse['usage'] : {};
    const inputTokens = typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0;
    const outputTokens = typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0;

    const response: InternalLLMResponse = {
      content,
      model: typeof providerResponse['model'] === 'string' ? providerResponse['model'] : '',
      finishReason: mapFinishReason(choice['finish_reason'] as string | undefined),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };

    // Map tool calls from response
    if (message && Array.isArray(message['tool_calls'])) {
      response.toolCalls = (message['tool_calls'] as Record<string, unknown>[]).map((tc) => {
        const fn = tc['function'] as Record<string, unknown>;
        return {
          id: String(tc['id'] ?? ''),
          type: 'function' as const,
          function: {
            name: String(fn['name'] ?? ''),
            arguments: String(fn['arguments'] ?? ''),
          },
        };
      });
    }

    return response;
  },
};
