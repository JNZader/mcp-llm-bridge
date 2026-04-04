/**
 * Comparison module — type definitions.
 *
 * Contracts for the multi-model comparison endpoint.
 * All types are derived from Zod schemas in schemas.ts via z.infer<>.
 * These manual interfaces exist for documentation and cases where
 * the schema isn't the canonical source.
 */

/** Input request for a multi-model comparison. */
export interface CompareRequest {
	/** The prompt to send to all models. */
	prompt: string;
	/** Optional system prompt. */
	system?: string;
	/** List of model IDs to compare (2-5). */
	models: string[];
	/** Max output tokens per model (default: 1024). */
	maxTokens?: number;
	/** Per-model timeout in ms (default: 30000, max: 120000). */
	timeoutMs?: number;
	/** Maximum estimated cost in USD — reject if total estimate exceeds this. */
	maxEstimatedCost?: number;
	/** Whether to persist the comparison result to SQLite (default: false). */
	persist?: boolean;
	/** Project scope for persistence (default: '__global__'). */
	project?: string;
}

/** Result for a single model within a comparison. */
export interface CompareModelResult {
	/** Model ID that was queried. */
	model: string;
	/** Provider that handled the request. */
	provider: string;
	/** Outcome of the model request. */
	status: "success" | "error" | "timeout";
	/** The model's response text (only on success). */
	response?: string;
	/** Error message (only on error/timeout). */
	error?: string;
	/** Input tokens consumed. */
	tokensIn: number;
	/** Output tokens consumed. */
	tokensOut: number;
	/** Cost in USD for this model's response. */
	costUsd: number;
	/** Latency in milliseconds. */
	latencyMs: number;
	/** Why the model stopped generating. */
	finishReason?: string;
	/** Stability score from FreeModelRegistry (0-100, only for free-tier models). */
	stabilityScore?: number;
}

/** Summary statistics across all model results. */
export interface ComparisonSummary {
	/** Model ID of the fastest successful response (undefined if all failed). */
	fastestModel?: string;
	/** Model ID of the cheapest successful response (undefined if all failed). */
	cheapestModel?: string;
	/** Total cost in USD across all models. */
	totalCost: number;
	/** Wall-clock time in ms for the entire comparison (max of all latencies). */
	wallClockMs: number;
}

/** Full response from a comparison request. */
export interface CompareResponse {
	/** Unique comparison ID (UUID). */
	id: string;
	/** The original prompt. */
	prompt: string;
	/** Per-model results. */
	results: CompareModelResult[];
	/** Aggregated summary. */
	summary: ComparisonSummary;
	/** ISO timestamp of when the comparison was created. */
	createdAt: string;
}
