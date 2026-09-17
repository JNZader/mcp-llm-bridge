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
 * - Optional `project` scopes credentials and cache entries separately.
 */

import type { ModelInfo } from '../core/types.js';
import { logger } from '../core/logger.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
/** After a discovery error, retry this soon instead of waiting the full TTL. */
export const MODEL_DISCOVERY_ERROR_RETRY_MS = 30 * 1000;
/** Fallback token cap for models discovered via /models (which omits limits). */
export const DEFAULT_DISCOVERED_MAX_TOKENS = 4096;

export interface MergeModelsOptions {
	/** Drop declared ids that the live catalog no longer reports. CLI config
	 *  sources stay on the default UNION so an incomplete config.toml cannot
	 *  wipe the curated fallback. */
	pruneMissingDeclared?: boolean;
}

/**
 * Merge declared and discovered models, deduping by id.
 *
 * Declared entries are the CURATED baseline (friendly names, correct
 * maxTokens) and WIN on id collision; discovery only ADDS genuinely new ids
 * that aren't already declared. This keeps curated metadata intact when a
 * provider's /models endpoint reports bare ids without limits.
 *
 * API adapters pass `pruneMissingDeclared` so a successful /models catalog
 * stops advertising deprecated declared ids. Empty discovery does not prune.
 */
export function mergeModels(
	declared: ModelInfo[],
	discovered: ModelInfo[],
	options: MergeModelsOptions = {},
): ModelInfo[] {
	if (options.pruneMissingDeclared && discovered.length > 0) {
		const discoveredById = new Map(discovered.map((model) => [model.id, model]));
		const merged: ModelInfo[] = [];
		for (const model of declared) {
			if (discoveredById.has(model.id)) {
				merged.push(model);
				discoveredById.delete(model.id);
			}
		}
		for (const model of discoveredById.values()) {
			merged.push(model);
		}
		return merged;
	}

	const byId = new Map<string, ModelInfo>();
	for (const model of [...declared, ...discovered]) {
		if (!byId.has(model.id)) {
			byId.set(model.id, model);
		}
	}
	return [...byId.values()];
}

/** A discovery function: returns models, or null when no dynamic source applies. */
export type DiscoverFn = (project?: string) => Promise<ModelInfo[] | null>;

interface ScopeState {
	cache: ModelInfo[] | null;
	fetchedAt: number;
	inFlight: Promise<void> | null;
}

export class DynamicModelCache {
	private readonly scopes = new Map<string, ScopeState>();
	private lastScopeKey = '';

	private readonly ttlMs: number;

	constructor(
		private readonly declared: ModelInfo[],
		private readonly discover: DiscoverFn,
		private readonly providerId: string,
		ttlMs: number = DEFAULT_TTL_MS,
		private readonly pruneMissingDeclared: boolean = false,
	) {
		this.ttlMs = Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS;
	}

	/** Current models — cached list, or the declared fallback before any refresh. */
	get(project?: string): ModelInfo[] {
		const key = project !== undefined ? scopeKey(project) : this.lastScopeKey;
		return this.scopes.get(key)?.cache ?? this.declared;
	}

	/**
	 * Refresh the cache if the TTL has elapsed. Never throws. Single-flighted:
	 * concurrent callers share one discovery (important now that discovery can
	 * be a network call on the routing path). `now` is injectable for testing.
	 */
	async refresh(now: number = Date.now(), project?: string): Promise<void> {
		const key = scopeKey(project);
		this.lastScopeKey = key;
		const scope = this.scope(key);
		if (scope.cache && now - scope.fetchedAt < this.ttlMs) {
			return;
		}
		if (scope.inFlight) {
			return scope.inFlight;
		}
		scope.inFlight = this.doRefresh(now, project, scope).finally(() => {
			scope.inFlight = null;
		});
		return scope.inFlight;
	}

	private scope(key: string): ScopeState {
		const existing = this.scopes.get(key);
		if (existing) {
			return existing;
		}
		const created: ScopeState = { cache: null, fetchedAt: 0, inFlight: null };
		this.scopes.set(key, created);
		return created;
	}

	private async doRefresh(
		now: number,
		project: string | undefined,
		scope: ScopeState,
	): Promise<void> {
		try {
			const discovered = await this.discover(project);
			scope.cache = discovered
				? mergeModels(this.declared, discovered, {
						pruneMissingDeclared: this.pruneMissingDeclared,
					})
				: this.declared;
			scope.fetchedAt = now;
		} catch (error) {
			logger.warn(
				{ provider: this.providerId, err: error, project },
				'model discovery threw; serving declared fallback',
			);
			scope.cache = scope.cache ?? this.declared;
			scope.fetchedAt = now - this.ttlMs + MODEL_DISCOVERY_ERROR_RETRY_MS;
		}
	}
}

function scopeKey(project?: string): string {
	return project ?? '';
}
