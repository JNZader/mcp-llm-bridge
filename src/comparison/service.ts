/**
 * ComparisonService — orchestrates parallel multi-model LLM comparisons.
 *
 * Thin composition layer over Router, Pricing, and FreeModelRegistry.
 * Fans out N parallel generateFromInternal() calls, enriches results
 * with cost/stability/latency metadata, and optionally persists.
 */

import { randomUUID } from "node:crypto";
import type { InternalLLMRequest } from "../core/internal-model.js";
import { logger } from "../core/logger.js";
import { calculateCost, estimateCost } from "../core/pricing.js";
import type { Router } from "../core/router.js";
import type { FreeModelRegistry } from "../free-models/registry.js";
import type { ComparisonQueryFilters, ComparisonStore } from "./persistence.js";
import type {
	CompareModelResult,
	CompareRequest,
	CompareResponse,
	ComparisonSummary,
} from "./types.js";

/** Configuration options for ComparisonService. */
export interface ComparisonServiceOptions {
	/** FreeModelRegistry for stability score enrichment. */
	freeModelRegistry?: FreeModelRegistry;
	/** ComparisonStore for optional persistence. */
	store?: ComparisonStore;
	/**
	 * Server-wide maximum cost ceiling in USD.
	 * Per-request maxEstimatedCost can be lower but never exceeds this.
	 * Defaults to MAX_COMPARISON_COST_USD env var, then $1.00.
	 */
	maxCostCeiling?: number;
	/** Default per-model timeout in ms (used when request doesn't specify). */
	defaultTimeoutMs?: number;
}

/** Error thrown when estimated cost exceeds the budget. */
export class CostExceededError extends Error {
	constructor(
		public readonly estimatedCost: number,
		public readonly limit: number,
	) {
		super(
			`Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${limit.toFixed(4)}`,
		);
		this.name = "CostExceededError";
	}
}

/**
 * Resolve the server-wide cost ceiling from options or env.
 */
function resolveMaxCostCeiling(options?: ComparisonServiceOptions): number {
	if (options?.maxCostCeiling !== undefined) return options.maxCostCeiling;
	const envVal = process.env["MAX_COMPARISON_COST_USD"];
	if (envVal) {
		const parsed = parseFloat(envVal);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 1.0; // Default $1.00
}

export class ComparisonService {
	private readonly router: Router;
	private readonly freeModelRegistry?: FreeModelRegistry;
	private readonly store?: ComparisonStore;
	private readonly maxCostCeiling: number;
	private readonly defaultTimeoutMs: number;

	constructor(router: Router, options: ComparisonServiceOptions = {}) {
		this.router = router;
		this.freeModelRegistry = options.freeModelRegistry;
		this.store = options.store;
		this.maxCostCeiling = resolveMaxCostCeiling(options);
		this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
	}

	/**
	 * Execute a multi-model comparison.
	 *
	 * 1. Pre-flight cost guard
	 * 2. Fan-out via Promise.allSettled with per-model AbortController
	 * 3. Enrich results (cost, latency, stability)
	 * 4. Build summary
	 * 5. Optionally persist
	 */
	async compare(request: CompareRequest): Promise<CompareResponse> {
		const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
		const maxTokens = request.maxTokens ?? 1024;

		// ── 1. Pre-flight cost guard ──────────────────────────────
		if (
			request.maxEstimatedCost !== undefined ||
			this.maxCostCeiling < Infinity
		) {
			const effectiveLimit =
				request.maxEstimatedCost !== undefined
					? Math.min(request.maxEstimatedCost, this.maxCostCeiling)
					: this.maxCostCeiling;

			const totalEstimate = this.estimateTotalCost(request.models, maxTokens);

			if (totalEstimate > effectiveLimit) {
				throw new CostExceededError(totalEstimate, effectiveLimit);
			}
		}

		// ── 2. Fan-out parallel requests ──────────────────────────
		const wallClockStart = Date.now();

		const promises = request.models.map((model) =>
			this.executeModel(model, request, maxTokens, timeoutMs),
		);

		const settled = await Promise.allSettled(promises);
		const wallClockMs = Date.now() - wallClockStart;

		// ── 3. Collect results ────────────────────────────────────
		const results: CompareModelResult[] = settled.map((outcome, index) => {
			const model = request.models[index]!;
			if (outcome.status === "fulfilled") {
				return outcome.value;
			}
			// Rejected — determine if timeout or error
			const error =
				outcome.reason instanceof Error
					? outcome.reason
					: new Error(String(outcome.reason));
			const isTimeout =
				error.name === "AbortError" || error.message.includes("timed out");
			return {
				model,
				provider: "unknown",
				status: isTimeout ? ("timeout" as const) : ("error" as const),
				error: error.message,
				tokensIn: 0,
				tokensOut: 0,
				costUsd: 0,
				latencyMs: wallClockMs,
			};
		});

		// ── 4. Build summary ──────────────────────────────────────
		const summary = this.buildSummary(results, wallClockMs);

		// ── 5. Build response ─────────────────────────────────────
		const response: CompareResponse = {
			id: randomUUID(),
			prompt: request.prompt,
			results,
			summary,
			createdAt: new Date().toISOString(),
		};

		// ── 6. Persist if requested ───────────────────────────────
		if (request.persist && this.store) {
			try {
				this.store.save(
					response,
					request.system,
					request.models,
					request.project,
				);
			} catch (err) {
				logger.warn({ error: err }, "Failed to persist comparison result");
			}
		}

		return response;
	}

	/**
	 * Retrieve comparison history (delegates to store).
	 */
	getHistory(filters: ComparisonQueryFilters = {}): CompareResponse[] {
		if (!this.store) return [];
		return this.store.query(filters);
	}

	// ── Private helpers ─────────────────────────────────────────

	/**
	 * Estimate total cost across all models using pricing module.
	 * Uses conservative estimate: assume prompt is ~500 tokens input + maxTokens output.
	 */
	private estimateTotalCost(models: string[], maxTokens: number): number {
		// Rough estimate: 500 input tokens (conservative for short prompts)
		const estimatedInputTokens = 500;
		let total = 0;

		for (const model of models) {
			const estimate = estimateCost(model, estimatedInputTokens, maxTokens);
			if (estimate) {
				total += estimate.estimatedCost;
			}
			// Unknown models default to $0 — we don't block them
		}

		return total;
	}

	/**
	 * Execute a single model request with timeout via AbortController.
	 */
	private async executeModel(
		model: string,
		request: CompareRequest,
		maxTokens: number,
		timeoutMs: number,
	): Promise<CompareModelResult> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const startTime = Date.now();

		try {
			const internalRequest: InternalLLMRequest = {
				messages: [
					...(request.system
						? [{ role: "system" as const, content: request.system }]
						: []),
					{ role: "user" as const, content: request.prompt },
				],
				model,
				maxTokens,
				metadata: {
					signal: controller.signal,
					comparisonMode: true,
				},
			};

			const response = await this.router.generateFromInternal(internalRequest);
			const latencyMs = Date.now() - startTime;

			// Enrich with cost
			const costUsd = calculateCost(
				response.model,
				response.usage.inputTokens,
				response.usage.outputTokens,
			);

			// Enrich with stability score
			const stabilityScore = this.getStabilityScore(model);

			return {
				model: response.model,
				provider: (response.metadata?.["provider"] as string) ?? "unknown",
				status: "success",
				response: response.content,
				tokensIn: response.usage.inputTokens,
				tokensOut: response.usage.outputTokens,
				costUsd,
				latencyMs: (response.metadata?.["latencyMs"] as number) ?? latencyMs,
				finishReason: response.finishReason,
				stabilityScore,
			};
		} catch (error) {
			const latencyMs = Date.now() - startTime;
			const err = error instanceof Error ? error : new Error(String(error));
			const isTimeout =
				err.name === "AbortError" || err.message.includes("timed out");

			return {
				model,
				provider: "unknown",
				status: isTimeout ? "timeout" : "error",
				error: isTimeout
					? `Request timed out after ${timeoutMs}ms`
					: err.message,
				tokensIn: 0,
				tokensOut: 0,
				costUsd: 0,
				latencyMs,
				stabilityScore: this.getStabilityScore(model),
			};
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Look up stability score from FreeModelRegistry.
	 * Returns undefined if registry is not configured or model is not free-tier.
	 */
	private getStabilityScore(model: string): number | undefined {
		if (!this.freeModelRegistry) return undefined;

		// Try direct lookup by model ID
		const entry = this.freeModelRegistry.get(model);
		if (entry?.stabilityScore !== undefined) return entry.stabilityScore;

		// Search enabled models for matching modelId
		const allEnabled = this.freeModelRegistry.getEnabled();
		const match = allEnabled.find((m) => m.modelId === model || m.id === model);
		return match?.stabilityScore;
	}

	/**
	 * Build comparison summary from results.
	 * Only considers successful results for fastest/cheapest rankings.
	 */
	private buildSummary(
		results: CompareModelResult[],
		wallClockMs: number,
	): ComparisonSummary {
		const successful = results.filter((r) => r.status === "success");

		let fastestModel: string | undefined;
		let cheapestModel: string | undefined;
		let totalCost = 0;

		if (successful.length > 0) {
			// Find fastest (lowest latency)
			const fastest = successful.reduce((a, b) =>
				a.latencyMs < b.latencyMs ? a : b,
			);
			fastestModel = fastest.model;

			// Find cheapest (lowest cost)
			const cheapest = successful.reduce((a, b) =>
				a.costUsd < b.costUsd ? a : b,
			);
			cheapestModel = cheapest.model;
		}

		// Total cost includes all models (even failed ones, though they're $0)
		for (const result of results) {
			totalCost += result.costUsd;
		}

		return {
			fastestModel,
			cheapestModel,
			totalCost,
			wallClockMs,
		};
	}
}
