/**
 * Inbound transformer for OpenAI Responses API format.
 *
 * Detects and converts `/v1/responses`-shaped payloads into
 * the provider-agnostic InternalLLMRequest.
 *
 * The Responses API uses `input` (string or array of items) instead of `messages`.
 * Each item can be a string, an input message, or a structured content block.
 */

import type { InboundTransformer } from '../../core/transformer.js';
import { TransformError } from '../../core/transformer.js';
import type {
  InternalLLMRequest,
  InternalMessage,
  ContentPart,
  ToolDefinition,
  ToolChoice,
} from '../../core/internal-model.js';

// ── Helpers ─────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── Input item mapping ──────────────────────────────────────

/**
 * Convert a single Responses API input item to an InternalMessage.
 *
 * Items can be:
 * - { role: "user"|"assistant"|"system", content: string | ContentPart[] }
 * - { type: "message", role, content }
 */
function mapInputItem(item: unknown): InternalMessage {
  if (!isObject(item)) {
    throw new TransformError('Invalid input item — expected object', 'openai-responses');
  }

  // Responses API wraps messages in { type: "message", role, content }
  // but also accepts plain { role, content } format
  const role = item['role'];
  if (
    role !== 'system' &&
    role !== 'user' &&
    role !== 'assistant'
  ) {
    throw new TransformError(`Unsupported input item role: ${String(role)}`, 'openai-responses');
  }

  const content = mapInputContent(item['content']);

  return { role, content };
}

function mapInputContent(raw: unknown): string | ContentPart[] | undefined {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return undefined;

  if (Array.isArray(raw)) {
    return raw.map((part: unknown) => {
      if (!isObject(part)) {
        throw new TransformError('Invalid content part — expected object', 'openai-responses');
      }
      if (part['type'] === 'input_text' && typeof part['text'] === 'string') {
        return { type: 'text' as const, text: part['text'] };
      }
      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        return { type: 'text' as const, text: part['text'] };
      }
      if (part['type'] === 'input_image' && isObject(part['image_url'])) {
        const img = part['image_url'];
        return {
          type: 'image_url' as const,
          image_url: {
            url: img['url'] as string,
            ...(typeof img['detail'] === 'string'
              ? { detail: img['detail'] as 'auto' | 'low' | 'high' }
              : {}),
          },
        };
      }
      throw new TransformError(
        `Unsupported content part type: ${String(part['type'])}`,
        'openai-responses',
      );
    });
  }

  throw new TransformError('content must be string, array, or null', 'openai-responses');
}

// ── Tool definition mapping ─────────────────────────────────

function mapTools(raw: unknown): ToolDefinition[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((tool: unknown) => {
    if (!isObject(tool)) {
      throw new TransformError('Invalid tool definition', 'openai-responses');
    }
    // Responses API tools have { type: "function", name, description, parameters }
    // (flatter than Chat format which nests under `function`)
    if (tool['type'] === 'function') {
      const fn = isObject(tool['function']) ? tool['function'] : tool;
      return {
        type: 'function' as const,
        function: {
          name: String(fn['name'] ?? ''),
          ...(typeof fn['description'] === 'string' ? { description: fn['description'] } : {}),
          ...(isObject(fn['parameters'])
            ? { parameters: fn['parameters'] as Record<string, unknown> }
            : {}),
        },
      };
    }
    throw new TransformError(`Unsupported tool type: ${String(tool['type'])}`, 'openai-responses');
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

// ── Convert string input to messages ────────────────────────

function inputToMessages(input: unknown): InternalMessage[] {
  // String input → single user message
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }

  // Array input → map each item
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new TransformError('input array must not be empty', 'openai-responses');
    }
    return input.map(mapInputItem);
  }

  throw new TransformError('input must be a string or array', 'openai-responses');
}

// ── Transformer ─────────────────────────────────────────────

export const openaiResponsesInbound: InboundTransformer = {
  name: 'openai-responses',

  detect(request: unknown): boolean {
    if (!isObject(request)) return false;
    // Responses API uses `input` (string or array) and `model`, but NOT `messages`
    const hasInput =
      typeof request['input'] === 'string' || Array.isArray(request['input']);
    const hasModel = typeof request['model'] === 'string';
    const hasMessages = 'messages' in request;
    return hasInput && hasModel && !hasMessages;
  },

  transformRequest(raw: unknown): InternalLLMRequest {
    if (!isObject(raw)) {
      throw new TransformError('Request must be an object', 'openai-responses');
    }

    const input = raw['input'];
    if (input === undefined || input === null) {
      throw new TransformError('input is required', 'openai-responses');
    }

    const messages = inputToMessages(input);

    // Handle instructions → system message (prepend)
    if (typeof raw['instructions'] === 'string') {
      messages.unshift({ role: 'system', content: raw['instructions'] });
    }

    const request: InternalLLMRequest = { messages };

    // Model
    if (typeof raw['model'] === 'string') {
      request.model = raw['model'];
    }

    // Temperature
    if (typeof raw['temperature'] === 'number') {
      request.temperature = raw['temperature'];
    }

    // max_output_tokens → maxTokens (Responses API naming)
    if (typeof raw['max_output_tokens'] === 'number') {
      request.maxTokens = raw['max_output_tokens'];
    }

    // top_p → topP
    if (typeof raw['top_p'] === 'number') {
      request.topP = raw['top_p'];
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
