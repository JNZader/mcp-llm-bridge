/**
 * Protocol Converter Module
 * Bidirectional conversion between OpenAI, Anthropic, and Gemini APIs
 */

// Types
export type {
  ProtocolType,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalChoice,
  CanonicalUsage,
  ProtocolAdapter,
  AnthropicRequest,
  AnthropicResponse,
  AnthropicMessage,
  AnthropicContentBlock,
  GeminiRequest,
  GeminiResponse,
  GeminiContent,
  GeminiPart,
  GeminiCandidate,
  GeminiGenerationConfig,
  GeminiUsageMetadata,
} from './types.js';

// Main converter
export { ProtocolConverter } from './converter.js';

// Adapters
export { AnthropicAdapter } from './adapters/anthropic-adapter.js';
export { GeminiAdapter } from './adapters/gemini-adapter.js';

// OpenAI format utilities
export {
  normalizeOpenAIRequest,
  validateOpenAIResponse,
  createCanonicalResponse,
} from './openai-format.js';
