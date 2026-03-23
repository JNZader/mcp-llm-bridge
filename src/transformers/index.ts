/**
 * Transformer barrel — imports all transformers and registers them
 * in the default TransformerRegistry.
 *
 * Import this module at application startup to populate the registry.
 *
 * Inbound transformers (format auto-detection):
 * - openai-chat: OpenAI /v1/chat/completions format
 * - openai-responses: OpenAI /v1/responses format
 * - anthropic: Anthropic Messages API format
 *
 * Outbound transformers (provider dispatch):
 * - openai: OpenAI Chat format (also used by Groq, OpenRouter)
 * - anthropic: Anthropic Messages API format
 * - google: Google Gemini (OpenAI-compatible)
 *
 * Note: Groq and OpenRouter use OpenAI-compatible format, so they
 * share the openai outbound transformer under their own names.
 */

import { registry } from '../core/transformer.js';

// ── Inbound transformers ────────────────────────────────────

import { openaiChatInbound } from './inbound/openai-chat.js';
import { openaiResponsesInbound } from './inbound/openai-responses.js';
import { anthropicInbound } from './inbound/anthropic.js';

// ── Outbound transformers ───────────────────────────────────

import { openaiOutbound } from './outbound/openai.js';
import { anthropicOutbound } from './outbound/anthropic.js';
import { googleOutbound } from './outbound/google.js';

// ── Register inbound transformers ───────────────────────────
// Order matters for detection: more specific formats first.
// Anthropic is checked before OpenAI Chat because both have `messages`,
// but Anthropic requires `max_tokens` (number), making it more specific.

registry.registerInbound(anthropicInbound);
registry.registerInbound(openaiResponsesInbound);
registry.registerInbound(openaiChatInbound);

// ── Register outbound transformers ──────────────────────────

registry.registerOutbound('openai', openaiOutbound);
registry.registerOutbound('anthropic', anthropicOutbound);
registry.registerOutbound('google', googleOutbound);

// Groq and OpenRouter use OpenAI-compatible format
registry.registerOutbound('groq', openaiOutbound);
registry.registerOutbound('openrouter', openaiOutbound);

// ── Re-exports ──────────────────────────────────────────────

export { registry } from '../core/transformer.js';
export { openaiChatInbound } from './inbound/openai-chat.js';
export { openaiResponsesInbound } from './inbound/openai-responses.js';
export { anthropicInbound } from './inbound/anthropic.js';
export { openaiOutbound } from './outbound/openai.js';
export { anthropicOutbound } from './outbound/anthropic.js';
export { googleOutbound } from './outbound/google.js';
