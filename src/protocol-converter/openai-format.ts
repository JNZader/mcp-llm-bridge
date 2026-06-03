/**
 * OpenAI Format Utilities
 * Canonical format helpers since OpenAI is the internal standard
 */

import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalUsage,
} from './types.js';

export interface OpenAIUsageInput {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface OpenAIUsageWithExactSplit {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
}

function hasExactSplit(usage: OpenAIUsageInput): usage is OpenAIUsageWithExactSplit {
  return (
    typeof usage.promptTokens === 'number' &&
    typeof usage.completionTokens === 'number'
  );
}

export function createOpenAIUsage(usage: OpenAIUsageWithExactSplit): CanonicalUsage;
export function createOpenAIUsage(usage: OpenAIUsageInput): { total_tokens: number } | CanonicalUsage;
export function createOpenAIUsage(usage: OpenAIUsageInput) {
  if (hasExactSplit(usage)) {
    return {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.promptTokens + usage.completionTokens,
    };
  }

  return {
    total_tokens: usage.totalTokens ?? 0,
  };
}

// OpenAI is the canonical format, so minimal transformation needed
export function normalizeOpenAIRequest(request: unknown): CanonicalRequest {
  const req = request as CanonicalRequest;

  // Validate required fields
  // Note: model is optional in the gateway schema (router can auto-select),
  // so we normalize to empty string rather than throwing.
  const model = req.model ?? '';

  if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
    throw new Error('Missing or invalid field: messages');
  }

  // Normalize messages to ensure proper role types
  const normalizedMessages: CanonicalMessage[] = req.messages.map(msg => ({
    role: validateRole(msg.role),
    content: typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''),
  }));

  return {
    model,
    messages: normalizedMessages,
    temperature: req.temperature,
    max_tokens: req.max_tokens,
    stream: req.stream ?? false,
    ...extractAdditionalParams(req),
  };
}

export function validateOpenAIResponse(response: unknown): CanonicalResponse {
  const resp = response as CanonicalResponse;

  if (!resp.id || !resp.model || !resp.choices || !resp.usage) {
    throw new Error('Invalid OpenAI response structure');
  }

  return resp;
}

function validateRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'system' || role === 'user' || role === 'assistant') {
    return role;
  }
  // Map alternate roles
  if (role === 'model') return 'assistant';
  throw new Error(`Invalid message role: ${role}`);
}

function extractAdditionalParams(req: CanonicalRequest): Record<string, unknown> {
  const { model, messages, temperature, max_tokens, stream, ...rest } = req;
  return rest;
}

// Helper to create a canonical response from partial data
export function createCanonicalResponse(
  id: string,
  model: string,
  content: string,
  usage: { prompt: number; completion: number }
): CanonicalResponse {
  return {
    id,
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
      },
      finish_reason: 'stop',
    }],
    usage: createOpenAIUsage({
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
    }),
  };
}
