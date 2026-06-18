/**
 * Shared TTL-cached dynamic model registry.
 *
 * Composed by both adapter hierarchies (CLI and OpenAI-compatible API) plus
 * the standalone anthropic/openai adapters, so the discovery/caching policy
 * lives in exactly one place.
 *
 * Policy:
 * - `get()` returns the cached list, or the declared fallback until first refresh.
 * - `refresh()` is TTL-gated; it calls the injected `discover` fn and merges
 *   the result with the declared baseline. A null result (no dynamic source /
 *   nothing found) is a stable answer and keeps the full TTL. A thrown error
 *   degrades to the declared list, is logged, and retries after a short window.
 */

import type { ModelInfo } from '../core/types.js';
import { logger } from '../core/logger.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
/** After a discovery error, retry this soon instead of waiting the full TTL. */
export const MODEL_DISCOVERY_ERROR_RETRY_MS = 30 * 1000;
/** Fallback token cap for models discovered via /models (which omits limits). */
export const DEFAULT_DISCOVERED_MAX_TOKENS = 4096;

/**
 * Merge declared and discovered models, deduping by id.
 *
 * Declared entries are the CURATED baseline (friendly names, correct
 * maxTokens) and WIN on id collision; discovery only ADDS genuinely new ids
 * that aren't already declared. This keeps curated metadata intact when a
 * provider's /models endpoint reports bare ids without limits.
 *
 * Known limitation (pre-existing, both merge directions): this is a UNION —
 * declared ids are always advertised even if the provider stopped serving
 * them. Pruning declared ids absent from a non-null discovery is a backlog
 * item; it would change semantics for config/CLI providers with no /models
 * source, so it's intentionally not done here.
 */
export function mergeModels(declared: ModelInfo[], discovered: ModelInfo[]): ModelInfo[] {
  const byId = new Map<string, ModelInfo>();
  for (const model of [...declared, ...discovered]) {
    if (!byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }
  return [...byId.values()];
}

/** A discovery function: returns models, or null when no dynamic source applies. */
export type DiscoverFn = () => Promise<ModelInfo[] | null>;

export class DynamicModelCache {
  private cache: ModelInfo[] | null = null;
  private fetchedAt = 0;
  /** In-flight refresh, shared so concurrent callers don't all hit discovery. */
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly declared: ModelInfo[],
    private readonly discover: DiscoverFn,
    private readonly providerId: string,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  /** Current models — cached list, or the declared fallback before any refresh. */
  get(): ModelInfo[] {
    return this.cache ?? this.declared;
  }

  /**
   * Refresh the cache if the TTL has elapsed. Never throws. Single-flighted:
   * concurrent callers share one discovery (important now that discovery can
   * be a network call on the routing path). `now` is injectable for testing.
   */
  async refresh(now: number = Date.now()): Promise<void> {
    if (this.cache && now - this.fetchedAt < this.ttlMs) {
      return;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.doRefresh(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(now: number): Promise<void> {
    try {
      const discovered = await this.discover();
      this.cache = discovered ? mergeModels(this.declared, discovered) : this.declared;
      this.fetchedAt = now;
    } catch (error) {
      logger.warn(
        { provider: this.providerId, err: error },
        'model discovery threw; serving declared fallback',
      );
      this.cache = this.cache ?? this.declared;
      // Back-date so the next call retries after the short error window.
      this.fetchedAt = now - this.ttlMs + MODEL_DISCOVERY_ERROR_RETRY_MS;
    }
  }
}
