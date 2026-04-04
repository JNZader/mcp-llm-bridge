/**
 * Comparison module — barrel export.
 *
 * Re-exports all public types, schemas, services, and persistence
 * for the multi-model comparison feature.
 */

export type { ComparisonQueryFilters } from "./persistence.js";
export { ComparisonStore } from "./persistence.js";
export type { CompareRequestInput } from "./schemas.js";
export {
	CompareRequestSchema,
	CompareResponseSchema,
	ComparisonSummarySchema,
	ModelResultSchema,
} from "./schemas.js";
export type { ComparisonServiceOptions } from "./service.js";
export {
	ComparisonService,
	CostExceededError,
} from "./service.js";
export type {
	CompareModelResult,
	CompareRequest,
	CompareResponse,
	ComparisonSummary,
} from "./types.js";
