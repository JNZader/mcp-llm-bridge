/**
 * Outbound transformer for CLI-based adapters.
 *
 * CLI adapters don't make HTTP requests — they spawn processes.
 * This transformer converts InternalLLMRequest into the format
 * that BaseCliAdapter expects: a prompt string + options.
 *
 * The provider response is raw CLI stdout or a generate() object.
 * Token usage is forwarded only when `usageProvenance` is present and valid;
 * otherwise usage stays unknown instead of a fabricated 0/0 split.
 */

import type { OutboundTransformer } from '../../core/transformer.js';
import { TransformError } from '../../core/transformer.js';
import type {
  InternalLLMRequest,
  InternalLLMResponse,
  InternalMessage,
} from '../../core/internal-model.js';
import { readUsageProvenance } from '../../core/usage-provenance.js';

// ── Helpers ─────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Flatten messages into a single prompt string.
 *
 * CLI tools expect a single text prompt. We concatenate:
 * - System messages → prefixed at the top
 * - Conversation history → role-prefixed
 * - Last user message → the main prompt
 */
function flattenMessages(messages: readonly InternalMessage[]): {
  prompt: string;
  system: string | undefined;
} {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of messages) {
    const text = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join('\n')
        : '';

    if (!text) continue;

    if (msg.role === 'system') {
      systemParts.push(text);
    } else {
      conversationParts.push(text);
    }
  }

  const system = systemParts.length > 0 ? systemParts.join('\n') : undefined;

  // If there are conversation parts, join them as the prompt.
  // If only system messages exist, use system as the prompt too.
  const prompt = conversationParts.length > 0
    ? conversationParts.join('\n')
    : system ?? '';

  return { prompt, system };
}

// ── Transformer ─────────────────────────────────────────────

export const cliOutbound: OutboundTransformer = {
  name: 'cli',

  transformRequest(internal: InternalLLMRequest): unknown {
    if (!internal.messages || internal.messages.length === 0) {
      throw new TransformError('At least one message is required', 'cli');
    }

    const { prompt, system } = flattenMessages(internal.messages);

    const result: Record<string, unknown> = {
      prompt,
    };

    if (system) result['system'] = system;
    if (internal.model) result['model'] = internal.model;
    if (internal.maxTokens !== undefined) result['maxTokens'] = internal.maxTokens;
    if (internal.temperature !== undefined) result['temperature'] = internal.temperature;

    return result;
  },

  transformResponse(providerResponse: unknown): InternalLLMResponse {
    // CLI responses can be a plain string (raw stdout) or an object
    // with a text field (from BaseCliAdapter.generate())
    let content: string;

    if (typeof providerResponse === 'string') {
      content = providerResponse;
    } else if (isObject(providerResponse)) {
      const text = providerResponse['text'];
      if (typeof text === 'string') {
        content = text;
      } else {
        throw new TransformError('CLI response object must have a "text" field', 'cli');
      }
    } else {
      throw new TransformError('CLI response must be a string or object with text', 'cli');
    }

    const model = isObject(providerResponse) && typeof providerResponse['model'] === 'string'
      ? providerResponse['model']
      : 'cli-unknown';

    // Forward validated CLI provenance when present. Otherwise leave usage
    // unknown rather than persisting a fabricated 0/0 split.
    const usageProvenance = isObject(providerResponse)
      ? readUsageProvenance(providerResponse['usageProvenance'])
      : undefined;

    const metadata = {
      ...(usageProvenance ? { usageProvenance } : {}),
      ...(isObject(providerResponse) && providerResponse['toolEvidence']
        ? { toolEvidence: providerResponse['toolEvidence'] }
        : {}),
    };

    return {
      content,
      model,
      finishReason: 'stop',
      usage: {},
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  },
};
