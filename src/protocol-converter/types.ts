/**
 * Protocol Converter - Type Definitions
 * Bidirectional conversion between OpenAI, Anthropic, and Gemini APIs
 */

export type ProtocolType = 'openai' | 'anthropic' | 'gemini';

// Canonical internal format (OpenAI-style)
export interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // Allow additional OpenAI-style params
  [key: string]: unknown;
}

export interface CanonicalChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

export interface CanonicalUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CanonicalResponse {
  id: string;
  model: string;
  choices: CanonicalChoice[];
  usage: CanonicalUsage;
  // Allow additional properties
  [key: string]: unknown;
}

// Protocol-specific adapters implement this
export interface ProtocolAdapter {
  readonly protocol: ProtocolType;

  // Convert from protocol-specific format to canonical
  toCanonical(request: unknown): CanonicalRequest;

  // Convert from canonical to protocol-specific format
  fromCanonical(response: CanonicalResponse): unknown;

  // Convert streaming chunk (optional for adapters)
  fromCanonicalStreamChunk?(chunk: unknown): unknown;
}

// Conversion result interface
export interface ConversionResult {
  canonical: CanonicalRequest;
  targetProtocol: ProtocolType;
}

// Anthropic-specific types
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface AnthropicRequest {
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface AnthropicResponse {
  id: string;
  model: string;
  content: AnthropicContentBlock[];
  role: 'assistant';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: string;
  [key: string]: unknown;
}

// Gemini-specific types
export interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  [key: string]: unknown;
}

export interface GeminiRequest {
  model: string;
  contents: GeminiContent[];
  generationConfig?: GeminiGenerationConfig;
  [key: string]: unknown;
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason: string;
  index?: number;
  [key: string]: unknown;
}

export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata: GeminiUsageMetadata;
  [key: string]: unknown;
}
