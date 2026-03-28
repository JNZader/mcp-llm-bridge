/**
 * OpenAI Format Utilities
 * Canonical format helpers since OpenAI is the internal standard
 */

import type { CanonicalRequest, CanonicalResponse, CanonicalMessage } from './types.js';

// OpenAI is the canonical format, so minimal transformation needed
export function normalizeOpenAIRequest(request: unknown): CanonicalRequest {
  const req = request as CanonicalRequest;

  // Validate required fields
  if (!req.model) {
    throw new Error('Missing required field: model');
  }

  if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
    throw new Error('Missing or invalid field: messages');
  }

  // Normalize messages to ensure proper role types
  const normalizedMessages: CanonicalMessage[] = req.messages.map(msg => ({
    role: validateRole(msg.role),
    content: typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''),
  }));

  return {
    model: req.model,
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
    usage: {
      prompt_tokens: usage.prompt,
      completion_tokens: usage.completion,
      total_tokens: usage.prompt + usage.completion,
    },
  };
}
