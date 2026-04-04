/**
 * Protocol Converter - Main Orchestrator
 * Converts between OpenAI, Anthropic, and Gemini API formats
 */

import type {
  ProtocolType,
  CanonicalRequest,
  CanonicalResponse,
  ProtocolAdapter,
  ConversionResult,
} from './types.js';
import { AnthropicAdapter } from './adapters/anthropic-adapter.js';
import { GeminiAdapter } from './adapters/gemini-adapter.js';
import { normalizeOpenAIRequest } from './openai-format.js';

export class ProtocolConverter {
  private adapters: Map<ProtocolType, ProtocolAdapter>;
  // Canonical format is always OpenAI

  constructor() {
    this.adapters = new Map<ProtocolType, ProtocolAdapter>([
      ['anthropic', new AnthropicAdapter()],
      ['gemini', new GeminiAdapter()],
    ]);
  }

  /**
   * Convert incoming request to canonical format
   * @param protocol The protocol of the incoming request
   * @param request The request payload
   * @returns Object with canonical request and detected target protocol
   */
  convertIncoming(
    protocol: ProtocolType,
    request: unknown
  ): ConversionResult {
    if (protocol === 'openai') {
      // Already canonical, just normalize
      const canonical = normalizeOpenAIRequest(request);
      return {
        canonical,
        targetProtocol: this.detectTargetProtocol(canonical),
      };
    }

    const adapter = this.adapters.get(protocol);
    if (!adapter) {
      throw new Error(`Unsupported protocol: ${protocol}`);
    }

    const canonical = adapter.toCanonical(request);
    return {
      canonical,
      targetProtocol: this.detectTargetProtocol(canonical),
    };
  }

  /**
   * Convert outgoing response from canonical format
   * @param targetProtocol The protocol to convert to
   * @param canonical The canonical response
   * @returns Protocol-specific response
   */
  convertOutgoing(
    targetProtocol: ProtocolType,
    canonical: CanonicalResponse
  ): unknown {
    if (targetProtocol === 'openai') {
      return canonical;
    }

    const adapter = this.adapters.get(targetProtocol);
    if (!adapter) {
      throw new Error(`Unsupported protocol: ${targetProtocol}`);
    }

    return adapter.fromCanonical(canonical);
  }

  /**
   * Convert streaming chunk
   * @param targetProtocol The protocol to convert to
   * @param chunk The canonical stream chunk
   * @returns Protocol-specific stream chunk
   */
  convertStreamChunk(
    targetProtocol: ProtocolType,
    chunk: unknown
  ): unknown {
    if (targetProtocol === 'openai') {
      return chunk;
    }

    const adapter = this.adapters.get(targetProtocol);
    if (!adapter?.fromCanonicalStreamChunk) {
      return chunk;
    }

    return adapter.fromCanonicalStreamChunk(chunk);
  }

  /**
   * Auto-detect target protocol from model name
   * @param canonical The canonical request with model information
   * @returns The detected protocol type
   */
  private detectTargetProtocol(canonical: CanonicalRequest): ProtocolType {
    const model = canonical.model.toLowerCase();

    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gemini')) return 'gemini';

    return 'openai'; // Default
  }

  /**
   * Register a custom protocol adapter
   * @param adapter The adapter to register
   */
  registerAdapter(adapter: ProtocolAdapter): void {
    this.adapters.set(adapter.protocol, adapter);
  }

  /**
   * Get list of supported protocols
   * @returns Array of supported protocol types
   */
  getSupportedProtocols(): ProtocolType[] {
    return ['openai', ...Array.from(this.adapters.keys())];
  }

  /**
   * Check if a protocol is supported
   * @param protocol The protocol to check
   * @returns true if supported
   */
  isProtocolSupported(protocol: ProtocolType): boolean {
    return protocol === 'openai' || this.adapters.has(protocol);
  }
}
