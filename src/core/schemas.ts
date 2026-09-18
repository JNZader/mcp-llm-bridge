/**
 * Zod validation schemas for request/response validation.
 * 
 * Provides runtime type checking for incoming requests.
 */

import { z } from 'zod';
import {
  MAX_CHAT_MESSAGES,
  MAX_CREDENTIAL_SECRET_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_PROMPT_LENGTH,
} from './constants.js';

const boundedText = (field: string) =>
  z.string().max(MAX_PROMPT_LENGTH, `${field} exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`);

const boundedIdentifier = z.string().max(MAX_IDENTIFIER_LENGTH);

export const ROUTING_MODE = {
  CONTRACTUAL: 'contractual',
} as const;
export type RoutingMode = (typeof ROUTING_MODE)[keyof typeof ROUTING_MODE];

export const RESPONSE_FORMAT = {
  JSON: 'json',
} as const;
export type ResponseFormat = (typeof RESPONSE_FORMAT)[keyof typeof RESPONSE_FORMAT];

/** Generate request schema. */
export const generateRequestSchema = z.object({
  prompt: boundedText('prompt').optional(),
  context: boundedText('context').optional(),
  instruction: boundedText('instruction').optional(),
  model: boundedIdentifier.optional(),
  provider: boundedIdentifier.optional(),
  requireProvider: z.boolean().optional(),
  system: boundedText('system').optional(),
  maxTokens: z.number().int().positive().optional(),
  /** Consorcio / OpenAI-style alias; mapped to maxTokens in prepareGenerateRequest. */
  max_tokens: z.number().int().positive().optional(),
  strict: z.boolean().optional(),
  routingMode: z.enum([ROUTING_MODE.CONTRACTUAL]).optional(),
  responseFormat: z.enum([RESPONSE_FORMAT.JSON]).optional(),
  project: boundedIdentifier.optional(),
  tools: z.literal('none').optional(),
}).superRefine((data, ctx) => {
  if (!data.prompt && !data.context && !data.instruction && !data.system) {
    ctx.addIssue({ code: 'custom', message: 'At least one of prompt, context, instruction, or system must be provided' });
  }
  if (data.requireProvider && !data.provider?.trim()) {
    ctx.addIssue({ code: 'custom', message: 'provider must be a non-blank string when requireProvider is true' });
  }
  if (data.responseFormat !== undefined && data.routingMode !== ROUTING_MODE.CONTRACTUAL) {
    ctx.addIssue({ code: 'custom', message: 'responseFormat is supported only for contractual generate requests' });
  }
});

/** Chat message schema. */
export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'developer', 'tool', 'function']),
  content: z.any(),
}).superRefine((data, ctx) => {
  if (typeof data.content === 'string' && data.content.length > MAX_PROMPT_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      message: `message content exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`,
      path: ['content'],
    });
  }
});

/** Chat completions request schema. */
export const chatCompletionsSchema = z.object({
  model: boundedIdentifier.optional(),
  messages: z.array(chatMessageSchema)
    .min(1, 'messages is required')
    .max(MAX_CHAT_MESSAGES, `messages exceeds maximum of ${MAX_CHAT_MESSAGES}`),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
  provider: boundedIdentifier.optional(),
  strict: z.boolean().optional(),
  routingMode: z.enum([ROUTING_MODE.CONTRACTUAL]).optional(),
  clientId: boundedIdentifier.optional(),
  project: boundedIdentifier.optional(),
}).passthrough().superRefine((data, ctx) => {
  if (Object.prototype.hasOwnProperty.call(data, 'requireProvider')) {
    ctx.addIssue({ code: 'custom', message: 'requireProvider is only supported by /v1/generate' });
  }
});

/** Credential store schema. */
export const credentialStoreSchema = z.object({
  provider: boundedIdentifier.min(1, 'provider is required'),
  keyName: boundedIdentifier.optional(),
  apiKey: z.string().min(1, 'apiKey is required').max(MAX_CREDENTIAL_SECRET_LENGTH),
  project: boundedIdentifier.optional(),
});

/** File store schema. */
export const fileStoreSchema = z.object({
  provider: boundedIdentifier.min(1, 'provider is required'),
  fileName: boundedIdentifier.min(1, 'fileName is required'),
  content: boundedText('content').min(1, 'content is required'),
  project: boundedIdentifier.optional(),
});

/** Cost estimate query schema (GET query params). */
export const costEstimateQuerySchema = z.object({
  model: z.string().min(1, 'model is required'),
  inputTokens: z.coerce.number().int().nonnegative('inputTokens must be >= 0'),
  outputTokens: z.coerce.number().int().nonnegative('outputTokens must be >= 0'),
});

/** Type exports. */
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type ChatCompletionsRequest = z.infer<typeof chatCompletionsSchema>;
export type CredentialStoreRequest = z.infer<typeof credentialStoreSchema>;
export type FileStoreRequest = z.infer<typeof fileStoreSchema>;
export type CostEstimateQuery = z.infer<typeof costEstimateQuerySchema>;

/**
 * Validate a generate request.
 * Returns the validated data or throws a ZodError.
 */
export function validateGenerateRequest(data: unknown) {
  return generateRequestSchema.parse(data);
}

/**
 * Validate a chat completions request.
 */
export function validateChatCompletions(data: unknown) {
  return chatCompletionsSchema.parse(data);
}

/**
 * Validate a credential store request.
 */
export function validateCredentialStore(data: unknown) {
  return credentialStoreSchema.parse(data);
}

/**
 * Validate a file store request.
 */
export function validateFileStore(data: unknown) {
  return fileStoreSchema.parse(data);
}
