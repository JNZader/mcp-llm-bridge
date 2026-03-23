/**
 * Inbound transformer for Anthropic Messages API format.
 *
 * Detects and converts Anthropic-shaped payloads into the
 * provider-agnostic InternalLLMRequest.
 *
 * Key differences from OpenAI Chat format:
 * - `max_tokens` is REQUIRED (not optional)
 * - `system` is a top-level string (not a message with role "system")
 * - Content can be an array of { type: "text", text: "..." } blocks
 */

import type { InboundTransformer } from '../../core/transformer.js';
import { TransformError } from '../../core/transformer.js';
import type {
  InternalLLMRequest,
  InternalMessage,
  ContentPart,
  ToolCall,
  ToolDefinition,
  ToolChoice,
} from '../../core/internal-model.js';

// ── Helpers ─────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── Content mapping ─────────────────────────────────────────

function mapContent(raw: unknown): string | ContentPart[] | undefined {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return undefined;

  if (Array.isArray(raw)) {
    return raw.map((part: unknown) => {
      if (!isObject(part)) {
        throw new TransformError('Invalid content block — expected object', 'anthropic');
      }
      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        return { type: 'text' as const, text: part['text'] };
      }
      if (part['type'] === 'image' && isObject(part['source'])) {
        const src = part['source'];
        // Anthropic uses base64 source, map to image_url with data URI
        if (src['type'] === 'base64' && typeof src['data'] === 'string') {
          const mediaType = typeof src['media_type'] === 'string' ? src['media_type'] : 'image/png';
          return {
            type: 'image_url' as const,
            image_url: {
              url: `data:${mediaType};base64,${src['data']}`,
            },
          };
        }
        // URL source
        if (src['type'] === 'url' && typeof src['url'] === 'string') {
          return {
            type: 'image_url' as const,
            image_url: { url: src['url'] as string },
          };
        }
        throw new TransformError('Unsupported image source type', 'anthropic');
      }
      if (part['type'] === 'tool_use') {
        // tool_use blocks are handled at the message level as tool calls
        // Skip here — they'll be processed in mapToolUseBlocks
        return null;
      }
      if (part['type'] === 'tool_result') {
        // tool_result is handled separately
        return null;
      }
      throw new TransformError(
        `Unsupported content block type: ${String(part['type'])}`,
        'anthropic',
      );
    }).filter((p): p is ContentPart => p !== null);
  }

  throw new TransformError('content must be string, array, or null', 'anthropic');
}

// ── Tool call mapping (from tool_use content blocks) ────────

function mapToolUseBlocks(content: unknown): ToolCall[] | undefined {
  if (!Array.isArray(content)) return undefined;

  const toolCalls: ToolCall[] = [];
  for (const block of content) {
    if (isObject(block) && block['type'] === 'tool_use') {
      toolCalls.push({
        id: String(block['id'] ?? ''),
        type: 'function' as const,
        function: {
          name: String(block['name'] ?? ''),
          arguments: typeof block['input'] === 'string'
            ? block['input']
            : JSON.stringify(block['input'] ?? {}),
        },
      });
    }
  }

  return toolCalls.length > 0 ? toolCalls : undefined;
}

// ── Tool definition mapping ─────────────────────────────────

function mapTools(raw: unknown): ToolDefinition[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((tool: unknown) => {
    if (!isObject(tool)) {
      throw new TransformError('Invalid tool definition', 'anthropic');
    }
    // Anthropic tools have { name, description, input_schema }
    return {
      type: 'function' as const,
      function: {
        name: String(tool['name'] ?? ''),
        ...(typeof tool['description'] === 'string' ? { description: tool['description'] } : {}),
        ...(isObject(tool['input_schema'])
          ? { parameters: tool['input_schema'] as Record<string, unknown> }
          : {}),
      },
    };
  });
}

// ── Tool choice mapping ─────────────────────────────────────

function mapToolChoice(raw: unknown): ToolChoice | undefined {
  if (raw === undefined || raw === null) return undefined;

  if (isObject(raw)) {
    const type = raw['type'];
    if (type === 'auto') return 'auto';
    if (type === 'any') return 'required';
    if (type === 'none') return 'none';
    if (type === 'tool' && typeof raw['name'] === 'string') {
      return {
        type: 'function' as const,
        function: { name: raw['name'] },
      };
    }
  }

  return undefined;
}

// ── Message mapping ─────────────────────────────────────────

function mapMessage(raw: unknown): InternalMessage {
  if (!isObject(raw)) {
    throw new TransformError('Invalid message — expected object', 'anthropic');
  }

  const role = raw['role'];
  if (role !== 'user' && role !== 'assistant') {
    throw new TransformError(
      `Unsupported message role: ${String(role)}. Anthropic uses top-level 'system' field.`,
      'anthropic',
    );
  }

  // Check for tool_result in content (user role with tool results)
  if (role === 'user' && Array.isArray(raw['content'])) {
    const blocks = raw['content'] as unknown[];
    const isToolResult = blocks.some(
      (b) => isObject(b) && b['type'] === 'tool_result',
    );
    if (isToolResult) {
      // Map tool_result blocks to tool messages
      // For simplicity, take the first tool_result
      const toolBlock = blocks.find(
        (b) => isObject(b) && b['type'] === 'tool_result',
      ) as Record<string, unknown>;
      const resultContent = typeof toolBlock['content'] === 'string'
        ? toolBlock['content']
        : JSON.stringify(toolBlock['content'] ?? '');
      return {
        role: 'tool',
        content: resultContent,
        toolCallId: String(toolBlock['tool_use_id'] ?? ''),
      };
    }
  }

  const content = mapContent(raw['content']);
  const msg: InternalMessage = { role, content };

  // Check for tool_use blocks in assistant messages
  if (role === 'assistant' && Array.isArray(raw['content'])) {
    const toolCalls = mapToolUseBlocks(raw['content']);
    if (toolCalls) {
      msg.toolCalls = toolCalls;
    }
  }

  return msg;
}

// ── Transformer ─────────────────────────────────────────────

export const anthropicInbound: InboundTransformer = {
  name: 'anthropic',

  detect(request: unknown): boolean {
    if (!isObject(request)) return false;
    // Anthropic format: must have `messages` array AND `max_tokens` (required in Anthropic)
    // Distinguish from OpenAI by requiring max_tokens (OpenAI has it optional)
    return (
      Array.isArray(request['messages']) &&
      typeof request['max_tokens'] === 'number'
    );
  },

  transformRequest(raw: unknown): InternalLLMRequest {
    if (!isObject(raw)) {
      throw new TransformError('Request must be an object', 'anthropic');
    }

    const rawMessages = raw['messages'];
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      throw new TransformError('messages must be a non-empty array', 'anthropic');
    }

    const messages: InternalMessage[] = [];

    // System message from top-level `system` field
    if (typeof raw['system'] === 'string') {
      messages.push({ role: 'system', content: raw['system'] });
    }
    // System can also be array of content blocks
    if (Array.isArray(raw['system'])) {
      const systemContent = mapContent(raw['system']);
      messages.push({ role: 'system', content: systemContent });
    }

    // Map conversation messages
    for (const msg of rawMessages) {
      messages.push(mapMessage(msg));
    }

    const request: InternalLLMRequest = { messages };

    // Model
    if (typeof raw['model'] === 'string') {
      request.model = raw['model'];
    }

    // max_tokens → maxTokens
    if (typeof raw['max_tokens'] === 'number') {
      request.maxTokens = raw['max_tokens'];
    }

    // Temperature
    if (typeof raw['temperature'] === 'number') {
      request.temperature = raw['temperature'];
    }

    // top_p → topP
    if (typeof raw['top_p'] === 'number') {
      request.topP = raw['top_p'];
    }

    // stop_sequences → stop
    if (Array.isArray(raw['stop_sequences'])) {
      request.stop = raw['stop_sequences'] as string[];
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
