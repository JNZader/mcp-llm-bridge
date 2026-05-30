import type { Hono } from "hono";

import { CompareRequestSchema } from "../../comparison/schemas.js";
import type { ComparisonService } from "../../comparison/service.js";
import { CostExceededError } from "../../comparison/service.js";

export interface ComparisonRouteDeps {
	comparisonService?: ComparisonService;
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

			let validated: ReturnType<typeof CompareRequestSchema.parse>;
			try {
				validated = CompareRequestSchema.parse(body);
			} catch (error) {
				if (error && typeof error === "object" && "issues" in error) {
					const issues = (
						error as { issues: Array<{ message: string; path: string[] }> }
					).issues;
					const firstIssue = issues[0];
					return c.json(
						{
							error: firstIssue?.message ?? "Validation error",
							code: "VALIDATION_ERROR",
							field: firstIssue?.path?.join(".") ?? "",
						},
						400,
					);
				}

				throw error;
			}

			const result = await comparisonService.compare(validated);
			return c.json(result);
		} catch (error) {
			if (error instanceof CostExceededError) {
				return c.json(
					{
						error: error.message,
						code: "COST_EXCEEDED",
						estimatedCost: error.estimatedCost,
						limit: error.limit,
					},
					422,
				);
			}

			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
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
			return c.json({ results, count: results.length });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});
}
