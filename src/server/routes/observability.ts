import type { Hono } from "hono";

import type { AnalyticsAggregator } from "../../analytics/index.js";
import { getMetrics, getMetricsContentType, updateProviderAvailability } from "../../core/metrics.js";
import type { Router } from "../../core/router.js";
import { LogQuerySchema } from "../../logging/schemas.js";
import type { RequestLogger } from "../../logging/request-logger.js";

const VALID_ANALYTICS_DIMENSIONS = ["total", "hourly", "daily", "channel", "model"] as const;

type AnalyticsDimension = (typeof VALID_ANALYTICS_DIMENSIONS)[number];

export interface ObservabilityRouteDeps {
	router: Router;
	analyticsAggregator?: AnalyticsAggregator;
	requestLogger?: RequestLogger;
}

export function registerObservabilityRoutes(
	app: Hono,
	deps: ObservabilityRouteDeps,
): void {
	const { router, analyticsAggregator, requestLogger } = deps;

	app.get("/v1/logs", async (c) => {
		try {
			if (!requestLogger) {
				return c.json({ error: "Request logging not enabled" }, 503);
			}

			const query = LogQuerySchema.parse(c.req.query());
			const logs = await requestLogger.getLogs(query);
			return c.json(logs);
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

			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/metrics", async (c) => {
		await updateProviderAvailability(router);
		const metrics = await getMetrics();
		return c.text(metrics, 200, { "Content-Type": getMetricsContentType() });
	});

	app.get("/v1/analytics", (c) => {
		try {
			if (!analyticsAggregator) {
				return c.json({ error: "Analytics not enabled" }, 503);
			}

			const dimension = (c.req.query("dimension") ?? "hourly") as AnalyticsDimension;
			const fromStr = c.req.query("from");
			const toStr = c.req.query("to");
			const channelId = c.req.query("channelId") || undefined;
			const model = c.req.query("model") || undefined;

			if (!VALID_ANALYTICS_DIMENSIONS.includes(dimension)) {
				return c.json(
					{
						error: "INVALID_PARAMS",
						message: `Invalid dimension: ${dimension}`,
					},
					400,
				);
			}

			let from: number | undefined;
			let to: number | undefined;
			if (fromStr !== undefined) {
				from = parseInt(fromStr, 10);
				if (isNaN(from)) {
					return c.json(
						{ error: "INVALID_PARAMS", message: "Invalid from timestamp" },
						400,
					);
				}
			}
			if (toStr !== undefined) {
				to = parseInt(toStr, 10);
				if (isNaN(to)) {
					return c.json(
						{ error: "INVALID_PARAMS", message: "Invalid to timestamp" },
						400,
					);
				}
			}
			if (from !== undefined && to !== undefined && from > to) {
				return c.json(
					{ error: "INVALID_PARAMS", message: "from must be <= to" },
					400,
				);
			}

			const data = analyticsAggregator.query({
				dimension,
				from,
				to,
				channelId,
				model,
			});

			const totalRequests = data.reduce((sum, item) => sum + item.requests, 0);
			const totalTokens = data.reduce(
				(sum, item) => sum + item.inputTokens + item.outputTokens,
				0,
			);
			const totalCost =
				Math.round(data.reduce((sum, item) => sum + item.cost, 0) * 1000000) /
				1000000;
			const avgLatency =
				totalRequests > 0
					? Math.round(
							data.reduce(
								(sum, item) => sum + item.avgLatency * item.requests,
								0,
							) / totalRequests,
						)
					: 0;

			return c.json({
				data,
				dimension,
				summary: {
					totalRequests,
					totalTokens,
					totalCost,
					avgLatency,
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/compression/stats", async (c) => {
		try {
			const { compressionStats } = await import("../../context-compression/output-compression.js");
			return c.json(compressionStats.getSummary());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});
}
