/**
 * Inbound transformer for OpenAI Chat Completions format.
 *
 * Detects and converts `/v1/chat/completions`-shaped payloads into
 * the provider-agnostic InternalLLMRequest.
 */

import type { InboundTransformer } from '../../core/transformer.js';
import { TransformError } from '../../core/transformer.js';
import type {
  InternalLLMRequest,
  InternalMessage,
  ToolCall,
  ToolDefinition,
  ContentPart,
  ToolChoice,
} from '../../core/internal-model.js';

// ── Helpers ─────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

// ── Content mapping ─────────────────────────────────────────

function mapContent(
  raw: unknown,
): string | ContentPart[] | undefined {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return undefined;

  if (Array.isArray(raw)) {
    return raw.map((part: unknown) => {
      if (!isObject(part)) {
        throw new TransformError('Invalid content part — expected object', 'openai-chat');
      }
      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        return { type: 'text' as const, text: part['text'] };
      }
      if (part['type'] === 'image_url' && isObject(part['image_url'])) {
        const img = part['image_url'];
        return {
          type: 'image_url' as const,
          image_url: {
            url: img['url'] as string,
            ...(typeof img['detail'] === 'string' ? { detail: img['detail'] as 'auto' | 'low' | 'high' } : {}),
          },
        };
      }
      throw new TransformError(`Unsupported content part type: ${String(part['type'])}`, 'openai-chat');
    });
  }

  throw new TransformError('content must be string, array, or null', 'openai-chat');
}

// ── Tool call mapping ───────────────────────────────────────

function mapToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((tc: unknown) => {
    if (!isObject(tc) || !isObject(tc['function'])) {
      throw new TransformError('Invalid tool call', 'openai-chat');
    }
    const fn = tc['function'];
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

// ── Tool definition mapping ─────────────────────────────────

function mapTools(raw: unknown): ToolDefinition[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((tool: unknown) => {
    if (!isObject(tool) || !isObject(tool['function'])) {
      throw new TransformError('Invalid tool definition', 'openai-chat');
    }
    const fn = tool['function'];
    return {
      type: 'function' as const,
      function: {
        name: String(fn['name'] ?? ''),
        ...(typeof fn['description'] === 'string' ? { description: fn['description'] } : {}),
        ...(isObject(fn['parameters']) ? { parameters: fn['parameters'] as Record<string, unknown> } : {}),
      },
    };
  });
}

// ── Tool choice mapping ─────────────────────────────────────

function mapToolChoice(raw: unknown): ToolChoice | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    if (raw === 'none' || raw === 'auto' || raw === 'required') return raw;
    return undefined;
  }
  if (isObject(raw) && raw['type'] === 'function' && isObject(raw['function'])) {
    const fn = raw['function'];
    return {
      type: 'function' as const,
      function: { name: String(fn['name'] ?? '') },
    };
  }
  return undefined;
}

// ── Message mapping ─────────────────────────────────────────

function mapMessage(raw: unknown): InternalMessage {
  if (!isObject(raw)) {
    throw new TransformError('Invalid message — expected object', 'openai-chat');
  }

  const role = raw['role'];
  if (
    role !== 'system' &&
    role !== 'user' &&
    role !== 'assistant' &&
    role !== 'tool'
  ) {
    throw new TransformError(`Unsupported message role: ${String(role)}`, 'openai-chat');
  }

  const msg: InternalMessage = {
    role,
    content: mapContent(raw['content']),
  };

  const toolCalls = mapToolCalls(raw['tool_calls']);
  if (toolCalls) {
    msg.toolCalls = toolCalls;
  }

  if (typeof raw['tool_call_id'] === 'string') {
    msg.toolCallId = raw['tool_call_id'];
  }

  return msg;
}

// ── Transformer ─────────────────────────────────────────────

export const openaiChatInbound: InboundTransformer = {
  name: 'openai-chat',

  detect(request: unknown): boolean {
    if (!isObject(request)) return false;
    // OpenAI Chat format: must have `messages` array and `model` field
    return Array.isArray(request['messages']) && typeof request['model'] === 'string';
  },

  transformRequest(raw: unknown): InternalLLMRequest {
    if (!isObject(raw)) {
      throw new TransformError('Request must be an object', 'openai-chat');
    }

    const rawMessages = raw['messages'];
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      throw new TransformError('messages must be a non-empty array', 'openai-chat');
    }

    const messages = rawMessages.map(mapMessage);

    const request: InternalLLMRequest = { messages };

    // Model
    if (typeof raw['model'] === 'string') {
      request.model = raw['model'];
    }

    // Temperature
    if (typeof raw['temperature'] === 'number') {
      request.temperature = raw['temperature'];
    }

    // max_tokens → maxTokens (snake_case → camelCase)
    if (typeof raw['max_tokens'] === 'number') {
      request.maxTokens = raw['max_tokens'];
    }

    // top_p → topP
    if (typeof raw['top_p'] === 'number') {
      request.topP = raw['top_p'];
    }

    // stop
    if (typeof raw['stop'] === 'string' || isStringArray(raw['stop'])) {
      request.stop = raw['stop'] as string | string[];
    }

    // Tools
    const tools = mapTools(raw['tools']);
    if (tools) {
      request.tools = tools;
    }

    // Tool choice
    const toolChoice = mapToolChoice(raw['tool_choice']);
    if (toolChoice !== undefined) {
      request.toolChoice = toolChoice;
    }

    return request;
  },
};
