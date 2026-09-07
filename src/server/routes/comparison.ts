import type { Hono } from "hono";
import type { CompareResponse } from "../../comparison/types.js";
import { safeError } from "../../core/safe-error.js";

import { CompareRequestSchema } from "../../comparison/schemas.js";
import type { ComparisonService } from "../../comparison/service.js";
import { getCostExceededDetails } from "../../comparison/service.js";

export interface ComparisonRouteDeps {
	comparisonService?: ComparisonService;
}

function projectComparisonResponse(response: CompareResponse) {
	return {
		id: response.id,
		prompt: response.prompt,
		createdAt: response.createdAt,
		results: response.results.map((result) => {
			const diagnostic = Object.getOwnPropertyDescriptor(result, "error");
			let error: string | null | undefined;
			if (diagnostic !== undefined) {
				if ("value" in diagnostic && diagnostic.value === null) error = null;
				else if (!("value" in diagnostic) || diagnostic.value !== undefined) {
					error = safeError("INTERNAL_ERROR").message;
				}
			}
			return {
				model: result.model,
				provider: result.provider,
				status: result.status,
				response: result.response,
				error,
				tokensIn: result.tokensIn,
				tokensOut: result.tokensOut,
				costUsd: result.costUsd,
				latencyMs: result.latencyMs,
				finishReason: result.finishReason,
				stabilityScore: result.stabilityScore,
			};
		}),
		summary: {
			fastestModel: response.summary.fastestModel,
			cheapestModel: response.summary.cheapestModel,
			totalCost: response.summary.totalCost,
			wallClockMs: response.summary.wallClockMs,
		},
	};
}

export function registerComparisonRoutes(
	app: Hono,
	deps: ComparisonRouteDeps,
): void {
	const { comparisonService } = deps;

	if (!comparisonService) {
		return;
	}

	app.post("/v1/compare", async (c) => {
		try {
			const body = await c.req.json();

			const validated = CompareRequestSchema.safeParse(body);
			if (!validated.success) {
				const firstField = validated.error.issues[0]?.path[0];
				const allowedFields = [
					"prompt", "system", "models", "maxTokens",
					"timeoutMs", "maxEstimatedCost", "persist", "project",
				];
				const field = typeof firstField === "string" && allowedFields.includes(firstField)
					? firstField : "";
				return c.json(
					{ error: safeError("INVALID_REQUEST").message, code: "VALIDATION_ERROR", field },
					400,
				);
			}

			const result = await comparisonService.compare(validated.data);
			return c.json(projectComparisonResponse(result));
		} catch (error) {
			const budget = getCostExceededDetails(error);
			if (budget !== undefined) {
				return c.json(
					{
						error: "Estimated cost exceeds the configured limit.",
						code: "COST_EXCEEDED",
						estimatedCost: budget.estimatedCost,
						limit: budget.limit,
					},
					422,
				);
			}

			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});

	app.get("/v1/compare/history", (c) => {
		try {
			const project = c.req.query("project") ?? undefined;
			const limitStr = c.req.query("limit");
			const offsetStr = c.req.query("offset");

			const rawLimit = limitStr ? parseInt(limitStr, 10) : 20;
			const limit = Math.min(isNaN(rawLimit) ? 20 : Math.max(1, rawLimit), 100);
			const rawOffset = offsetStr ? parseInt(offsetStr, 10) : 0;
			const offset = isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

			const results = comparisonService.getHistory({
				project,
				limit,
				offset,
			});
			return c.json({ results: results.map(projectComparisonResponse), count: results.length });
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
	});
}
