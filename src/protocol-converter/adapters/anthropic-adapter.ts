/**
 * Anthropic Protocol Adapter
 * Converts between Anthropic and OpenAI (canonical) formats
 */

import type {
  ProtocolAdapter,
  ProtocolType,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  AnthropicRequest,
  AnthropicResponse,
  AnthropicMessage,
  AnthropicContentBlock,
} from '../types.js';

export class AnthropicAdapter implements ProtocolAdapter {
  readonly protocol: ProtocolType = 'anthropic';

  toCanonical(anthropicRequest: AnthropicRequest): CanonicalRequest {
    // Validate input
    if (!anthropicRequest.model) {
      throw new Error('Anthropic request missing required field: model');
    }

    if (!anthropicRequest.messages || !Array.isArray(anthropicRequest.messages)) {
      throw new Error('Anthropic request missing or invalid field: messages');
    }

    // Anthropic uses 'system' as top-level field, not as a message
    const messages: CanonicalMessage[] = [];

    if (anthropicRequest.system) {
      messages.push({
        role: 'system',
        content: anthropicRequest.system,
      });
    }

    // Convert Anthropic's alternating user/assistant messages
    for (const msg of anthropicRequest.messages) {
      messages.push({
        role: this.mapAnthropicRole(msg.role),
        content: typeof msg.content === 'string'
          ? msg.content
          : this.extractTextFromContent(msg.content),
      });
    }

    return {
      model: anthropicRequest.model,
      messages,
      temperature: anthropicRequest.temperature,
      max_tokens: anthropicRequest.max_tokens,
      stream: anthropicRequest.stream ?? false,
    };
  }

  fromCanonical(canonical: CanonicalResponse): AnthropicResponse {
    const choice = canonical.choices[0];

    if (!choice) {
      throw new Error('Canonical response has no choices');
    }

    const content: AnthropicContentBlock[] = [
      {
        type: 'text',
        text: choice.message.content || '',
      },
    ];

    return {
      id: canonical.id,
      model: canonical.model,
      content,
      role: 'assistant',
      usage: {
        input_tokens: canonical.usage.prompt_tokens,
        output_tokens: canonical.usage.completion_tokens,
      },
      stop_reason: this.mapFinishReasonToAnthropic(choice.finish_reason),
    };
  }

  fromCanonicalStreamChunk(chunk: unknown): unknown {
    // For streaming, Anthropic uses SSE with JSON events
    // The chunk is already in canonical format, just pass through
    // or transform if needed based on the specific chunk structure
    return chunk;
  }

  private mapAnthropicRole(role: string): 'user' | 'assistant' {
    // Anthropic only uses 'user' and 'assistant' roles in messages
    // System is handled separately
    if (role === 'user' || role === 'assistant') {
      return role;
    }
    throw new Error(`Invalid Anthropic message role: ${role}`);
  }

  private extractTextFromContent(content: AnthropicContentBlock[]): string {
    // Handle Anthropic's content blocks (text, image, etc.)
    return content
      .filter((c): c is AnthropicContentBlock & { type: 'text'; text: string } =>
        c.type === 'text' && typeof c.text === 'string'
      )
      .map(c => c.text)
      .join('');
  }

  private mapFinishReasonToAnthropic(reason: string | undefined): string {
    const mappings: Record<string, string> = {
      'stop': 'end_turn',
      'length': 'max_tokens',
      'tool_calls': 'tool_use',
    };
    return mappings[reason || ''] || reason || 'end_turn';
  }

  // Reverse: Convert canonical to Anthropic request format
  toAnthropicRequest(canonical: CanonicalRequest): AnthropicRequest {
    let system: string | undefined;
    const messages: AnthropicMessage[] = [];

    for (const msg of canonical.messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    return {
      model: canonical.model,
      ...(system && { system }),
      messages,
      max_tokens: canonical.max_tokens,
      temperature: canonical.temperature,
      stream: canonical.stream,
    };
  }
}
