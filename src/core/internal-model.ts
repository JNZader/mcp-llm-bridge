/**
 * Provider-agnostic internal model for LLM requests and responses.
 *
 * Zod schemas are the source of truth — TS types derived via z.infer<>.
 * No provider-specific fields at the canonical level.
 */

import { z } from 'zod';

// ── Content Parts (for multimodal messages) ─────────────────

const TEXT_CONTENT_PART = {
  TEXT: 'text',
  IMAGE_URL: 'image_url',
} as const;

export const TextContentPartSchema = z.object({
  type: z.literal(TEXT_CONTENT_PART.TEXT),
  text: z.string(),
});

export const ImageContentPartSchema = z.object({
  type: z.literal(TEXT_CONTENT_PART.IMAGE_URL),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
});

export const ContentPartSchema = z.discriminatedUnion('type', [
  TextContentPartSchema,
  ImageContentPartSchema,
]);

export type ContentPart = z.infer<typeof ContentPartSchema>;

// ── Tool Call / Tool definitions ────────────────────────────

export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// ── Messages ────────────────────────────────────────────────

const MESSAGE_ROLE = {
  SYSTEM: 'system',
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
} as const;

export const InternalMessageSchema = z.object({
  role: z.enum([
    MESSAGE_ROLE.SYSTEM,
    MESSAGE_ROLE.USER,
    MESSAGE_ROLE.ASSISTANT,
    MESSAGE_ROLE.TOOL,
  ]),
  content: z.union([z.string(), z.array(ContentPartSchema)]).optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().optional(),
});

export type InternalMessage = z.infer<typeof InternalMessageSchema>;

// ── Tool Choice ─────────────────────────────────────────────

export const ToolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({
    type: z.literal('function'),
    function: z.object({ name: z.string() }),
  }),
]);

export type ToolChoice = z.infer<typeof ToolChoiceSchema>;

// ── Request ─────────────────────────────────────────────────

export const InternalLLMRequestSchema = z.object({
  messages: z.array(InternalMessageSchema).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  toolChoice: ToolChoiceSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InternalLLMRequest = z.infer<typeof InternalLLMRequestSchema>;

// ── Usage ───────────────────────────────────────────────────

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export type Usage = z.infer<typeof UsageSchema>;

// ── Response ────────────────────────────────────────────────

const FINISH_REASON = {
  STOP: 'stop',
  LENGTH: 'length',
  TOOL_CALLS: 'tool_calls',
  CONTENT_FILTER: 'content_filter',
  ERROR: 'error',
} as const;

export const InternalLLMResponseSchema = z.object({
  content: z.string(),
  usage: UsageSchema,
  model: z.string(),
  finishReason: z.enum([
    FINISH_REASON.STOP,
    FINISH_REASON.LENGTH,
    FINISH_REASON.TOOL_CALLS,
    FINISH_REASON.CONTENT_FILTER,
    FINISH_REASON.ERROR,
  ]),
  toolCalls: z.array(ToolCallSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InternalLLMResponse = z.infer<typeof InternalLLMResponseSchema>;
