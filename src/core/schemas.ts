/**
 * Zod validation schemas for request/response validation.
 * 
 * Provides runtime type checking for incoming requests.
 */

import { z } from 'zod';
import { MAX_PROMPT_LENGTH } from './constants.js';

/** Generate request schema. */
export const generateRequestSchema = z.object({
  prompt: z.string()
    .min(1, 'prompt is required')
    .max(MAX_PROMPT_LENGTH, `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`),
  model: z.string().optional(),
  provider: z.string().optional(),
  system: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  strict: z.boolean().optional(),
  project: z.string().optional(),
});

/** Chat message schema. */
export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

/** Chat completions request schema. */
export const chatCompletionsSchema = z.object({
  model: z.string().optional(),
  messages: z.array(chatMessageSchema)
    .min(1, 'messages is required'),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

/** Credential store schema. */
export const credentialStoreSchema = z.object({
  provider: z.string()
    .min(1, 'provider is required'),
  keyName: z.string().optional(),
  apiKey: z.string().min(1, 'apiKey is required'),
  project: z.string().optional(),
});

/** File store schema. */
export const fileStoreSchema = z.object({
  provider: z.string().min(1, 'provider is required'),
  fileName: z.string().min(1, 'fileName is required'),
  content: z.string().min(1, 'content is required'),
  project: z.string().optional(),
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
