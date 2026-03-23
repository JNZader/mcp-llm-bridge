/**
 * Transformer interfaces and registry for the gateway pipeline.
 *
 * Inbound transformers: detect and convert raw requests → InternalLLMRequest.
 * Outbound transformers: convert InternalLLMRequest → provider format and
 *   provider responses → InternalLLMResponse.
 *
 * The TransformerRegistry holds all registered transformers and provides
 * format detection and lookup by provider name.
 */

import type { InternalLLMRequest, InternalLLMResponse } from './internal-model.js';

// ── Inbound Transformer ─────────────────────────────────────

export interface InboundTransformer {
  /** Unique format name, e.g. 'openai-chat', 'anthropic'. */
  readonly name: string;

  /**
   * Returns true if this transformer can handle the given raw request.
   * Used by the registry for auto-detection.
   */
  detect(request: unknown): boolean;

  /**
   * Transform a raw request into the internal canonical format.
   * Callers MUST call detect() first — behaviour is undefined if
   * the request doesn't match.
   */
  transformRequest(raw: unknown): InternalLLMRequest;
}

// ── Outbound Transformer ────────────────────────────────────

export interface OutboundTransformer {
  /** Provider name this transformer targets, e.g. 'anthropic', 'openai'. */
  readonly name: string;

  /**
   * Convert an InternalLLMRequest into the provider's native request format.
   */
  transformRequest(internal: InternalLLMRequest): unknown;

  /**
   * Convert a provider's native response into InternalLLMResponse.
   */
  transformResponse(providerResponse: unknown): InternalLLMResponse;
}

// ── Transform Error ─────────────────────────────────────────

export class TransformError extends Error {
  constructor(
    message: string,
    public readonly format?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TransformError';
  }
}

// ── Registry ────────────────────────────────────────────────

export class TransformerRegistry {
  private readonly _inbound: InboundTransformer[] = [];
  private readonly _outbound = new Map<string, OutboundTransformer>();

  /** Register an inbound (format-detection) transformer. */
  registerInbound(transformer: InboundTransformer): void {
    this._inbound.push(transformer);
  }

  /** Register an outbound transformer keyed by provider name. */
  registerOutbound(name: string, transformer: OutboundTransformer): void {
    this._outbound.set(name, transformer);
  }

  /**
   * Detect which inbound transformer matches the raw request.
   * Returns the first matching transformer, or null if none match.
   */
  detectInbound(rawRequest: unknown): InboundTransformer | null {
    for (const t of this._inbound) {
      if (t.detect(rawRequest)) return t;
    }
    return null;
  }

  /**
   * Get an outbound transformer by provider name.
   * Returns null if no transformer is registered for that provider.
   */
  getOutbound(providerName: string): OutboundTransformer | null {
    return this._outbound.get(providerName) ?? null;
  }

  /** List all registered inbound format names. */
  get inboundFormats(): readonly string[] {
    return this._inbound.map((t) => t.name);
  }

  /** List all registered outbound provider names. */
  get outboundProviders(): readonly string[] {
    return [...this._outbound.keys()];
  }
}

/** Default singleton registry. */
export const registry = new TransformerRegistry();
