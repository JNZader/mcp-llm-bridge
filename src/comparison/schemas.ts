/**
 * Comparison module — Zod validation schemas.
 *
 * Validates incoming comparison requests and outgoing responses.
 * Schemas live here (not in core/schemas.ts) to maintain module cohesion.
 */

import { z } from "zod";
import { MAX_PROMPT_LENGTH } from "../core/constants.js";

// ── Request Schema ────────────────────────────────────────────

export const CompareRequestSchema = z.object({
	prompt: z
		.string()
		.min(1, "prompt is required")
		.max(
			MAX_PROMPT_LENGTH,
			`prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`,
		),
	system: z.string().optional(),
	models: z
		.array(z.string())
		.min(2, "models must have at least 2 items")
		.max(5, "models must have at most 5 items")
		.refine((models) => new Set(models).size === models.length, {
			message: "duplicate models not allowed",
		}),
	maxTokens: z.number().int().positive().optional().default(1024),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.max(120_000, "timeoutMs must be at most 120000")
		.optional()
		.default(30_000),
	maxEstimatedCost: z.number().positive().optional(),
	persist: z.boolean().optional().default(false),
	project: z.string().optional(),
});

export type CompareRequestInput = z.input<typeof CompareRequestSchema>;

// ── Model Result Schema ───────────────────────────────────────

export const ModelResultSchema = z.object({
	model: z.string(),
	provider: z.string(),
	status: z.enum(["success", "error", "timeout"]),
	response: z.string().optional(),
	error: z.string().optional(),
	tokensIn: z.number().int().nonnegative(),
	tokensOut: z.number().int().nonnegative(),
	costUsd: z.number(),
	latencyMs: z.number(),
	finishReason: z.string().optional(),
	stabilityScore: z.number().optional(),
});

// ── Summary Schema ────────────────────────────────────────────

export const ComparisonSummarySchema = z.object({
	fastestModel: z.string().optional(),
	cheapestModel: z.string().optional(),
	totalCost: z.number(),
	wallClockMs: z.number(),
});

// ── Response Schema ───────────────────────────────────────────

export const CompareResponseSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	results: z.array(ModelResultSchema),
	summary: ComparisonSummarySchema,
	createdAt: z.string(),
});
