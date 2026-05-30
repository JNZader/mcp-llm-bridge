import type { Hono } from "hono";

import { estimateCost, getPriceTable } from "../../core/pricing.js";
import type { Router } from "../../core/router.js";
import { costEstimateQuerySchema } from "../../core/schemas.js";
import type { LatencyMeasurer } from "../../latency/index.js";

export interface MetadataRouteDeps {
	router: Router;
	latencyMeasurer?: LatencyMeasurer;
}

export function registerMetadataRoutes(
	app: Hono,
	deps: MetadataRouteDeps,
): void {
	const { router, latencyMeasurer } = deps;

	app.get("/v1/models", async (c) => {
		try {
			const models = await router.getAvailableModels();
			return c.json({
				object: "list",
				data: models.map((m) => ({
					id: m.id,
					object: "model",
					created: 0,
					owned_by: "llm-gateway",
					name: m.name,
					provider: m.provider,
					max_tokens: m.maxTokens,
				})),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: {
						message,
						type: "server_error",
						param: null,
						code: null,
					},
				},
				500,
			);
		}
	});

	app.get("/v1/providers", async (c) => {
		try {
			const providers = await router.getProviderStatuses();
			return c.json({ providers });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/latency", (c) => {
		try {
			if (!latencyMeasurer) {
				return c.json(
					{
						error: "Latency measurement not enabled",
						code: "NOT_ENABLED",
					},
					503,
				);
			}

			const measurements = latencyMeasurer.getAll();
			const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
			const now = Date.now();

			return c.json({
				providers: measurements.map((m) => ({
					provider: m.provider,
					latencyMs: m.latencyMs,
					measuredAt: m.measuredAt,
					stale: now - m.measuredAt > TWO_HOURS_MS,
				})),
				count: measurements.length,
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/cost/estimate", (c) => {
		try {
			const query = {
				model: c.req.query("model"),
				inputTokens: c.req.query("inputTokens"),
				outputTokens: c.req.query("outputTokens"),
			};

			const parsed = costEstimateQuerySchema.safeParse(query);
			if (!parsed.success) {
				const issues = parsed.error.issues;
				const firstIssue = issues[0];
				return c.json(
					{
						error: "Validation error",
						details: firstIssue
							? `${firstIssue.path.join(".")}: ${firstIssue.message}`
							: "Invalid query parameters",
					},
					400,
				);
			}

			const result = estimateCost(
				parsed.data.model,
				parsed.data.inputTokens,
				parsed.data.outputTokens,
			);
			if (!result) {
				return c.json({ error: "Unknown model" }, 400);
			}

			return c.json(result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/cost/models", (c) => {
		try {
			const table = getPriceTable();
			return c.json(table);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});
}
