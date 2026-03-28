/**
 * Gemini Protocol Adapter
 * Converts between Gemini and OpenAI (canonical) formats
 */

import type {
  ProtocolAdapter,
  ProtocolType,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  GeminiRequest,
  GeminiResponse,
  GeminiContent,
  GeminiPart,
  GeminiCandidate,
  GeminiGenerationConfig,
} from '../types.js';

export class GeminiAdapter implements ProtocolAdapter {
  readonly protocol: ProtocolType = 'gemini';

  toCanonical(geminiRequest: GeminiRequest): CanonicalRequest {
    // Validate input
    if (!geminiRequest.model) {
      throw new Error('Gemini request missing required field: model');
    }

    if (!geminiRequest.contents || !Array.isArray(geminiRequest.contents)) {
      throw new Error('Gemini request missing or invalid field: contents');
    }

    // Gemini uses 'contents' with 'parts'
    const messages: CanonicalMessage[] = [];

    for (const content of geminiRequest.contents) {
      messages.push({
        role: this.mapGeminiRole(content.role),
        content: this.extractTextFromParts(content.parts),
      });
    }

    return {
      model: geminiRequest.model,
      messages,
      temperature: geminiRequest.generationConfig?.temperature,
      max_tokens: geminiRequest.generationConfig?.maxOutputTokens,
      // Gemini doesn't have a native stream flag in the same way
      stream: false,
      ...(geminiRequest.generationConfig && {
        topP: geminiRequest.generationConfig.topP,
        topK: geminiRequest.generationConfig.topK,
      }),
    };
  }

  fromCanonical(canonical: CanonicalResponse): GeminiResponse {
    const choice = canonical.choices[0];

    if (!choice) {
      throw new Error('Canonical response has no choices');
    }

    const candidate: GeminiCandidate = {
      content: {
        role: 'model',
        parts: [{ text: choice.message.content || '' }],
      },
      finishReason: this.mapFinishReasonToGemini(choice.finish_reason),
      index: 0,
    };

    return {
      candidates: [candidate],
      usageMetadata: {
        promptTokenCount: canonical.usage.prompt_tokens,
        candidatesTokenCount: canonical.usage.completion_tokens,
        totalTokenCount: canonical.usage.total_tokens,
      },
    };
  }

  fromCanonicalStreamChunk(chunk: unknown): unknown {
    // Gemini streaming returns chunks with candidates
    // Transform if needed based on specific chunk structure
    return chunk;
  }

  private mapGeminiRole(role: string): 'user' | 'assistant' {
    // Gemini uses 'user' and 'model' roles
    if (role === 'user') return 'user';
    if (role === 'model') return 'assistant';
    throw new Error(`Invalid Gemini content role: ${role}`);
  }

  private extractTextFromParts(parts: GeminiPart[]): string {
    return parts
      .filter((p): p is GeminiPart & { text: string } => typeof p.text === 'string')
      .map(p => p.text)
      .join('');
  }

  private mapFinishReasonToGemini(reason: string | undefined): string {
    const mappings: Record<string, string> = {
      'stop': 'STOP',
      'length': 'MAX_TOKENS',
      'tool_calls': 'OTHER',
      'content_filter': 'SAFETY',
    };
    return mappings[reason || ''] || 'OTHER';
  }

  // Reverse: Convert canonical to Gemini request format
  toGeminiRequest(canonical: CanonicalRequest): GeminiRequest {
    const contents: GeminiContent[] = [];

    for (const msg of canonical.messages) {
      // Skip system messages in Gemini (they use a different approach)
      if (msg.role === 'system') {
        // In Gemini, system instructions are set via systemInstruction field
        // For now, we'll include it as a user message with context
        continue;
      }

      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    const generationConfig: GeminiGenerationConfig = {};
    if (canonical.temperature !== undefined) {
      generationConfig.temperature = canonical.temperature;
    }
    if (canonical.max_tokens !== undefined) {
      generationConfig.maxOutputTokens = canonical.max_tokens;
    }

    return {
      model: canonical.model,
      contents,
      ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
    };
  }
}
