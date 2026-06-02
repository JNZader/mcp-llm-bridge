import type { Hono } from "hono";

import type {
	AggregatedDataPoint,
	AnalyticsAggregator,
	AnalyticsPersistenceReader,
} from "../../analytics/index.js";
import { getMetrics, getMetricsContentType, updateProviderAvailability } from "../../core/metrics.js";
import type { Router } from "../../core/router.js";
import { LogQuerySchema } from "../../logging/schemas.js";
import type { RequestLogger } from "../../logging/request-logger.js";

const VALID_ANALYTICS_DIMENSIONS = ["total", "hourly", "daily", "channel", "provider", "model"] as const;

const ANALYTICS_SOURCES = {
	LIVE: "live",
	DURABLE: "durable",
	MIXED: "mixed",
} as const;

type AnalyticsDimension = (typeof VALID_ANALYTICS_DIMENSIONS)[number];
type AnalyticsSource = (typeof ANALYTICS_SOURCES)[keyof typeof ANALYTICS_SOURCES];

function mergeTimeSeriesData(
	persistedData: AggregatedDataPoint[],
	liveData: AggregatedDataPoint[],
): AggregatedDataPoint[] {
	const mergedBuckets = new Map<number, AggregatedDataPoint>();

	for (const point of persistedData) {
		mergedBuckets.set(point.timestamp, point);
	}

	for (const point of liveData) {
		mergedBuckets.set(point.timestamp, point);
	}

	return Array.from(mergedBuckets.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function roundRate(value: number): number {
	return Math.round(value * 10000) / 10000;
}

function getAnalyticsSource(
	dimension: AnalyticsDimension,
	persistedCount: number,
	liveCount: number,
): AnalyticsSource {
	if (dimension === "hourly" || dimension === "daily") {
		if (persistedCount > 0 && liveCount > 0) {
			return ANALYTICS_SOURCES.MIXED;
		}

		if (persistedCount > 0) {
			return ANALYTICS_SOURCES.DURABLE;
		}
	}

	return ANALYTICS_SOURCES.LIVE;
}

export interface ObservabilityRouteDeps {
	router: Router;
	analyticsAggregator?: AnalyticsAggregator;
	analyticsReader?: AnalyticsPersistenceReader;
	requestLogger?: RequestLogger;
}

export function registerObservabilityRoutes(
	app: Hono,
	deps: ObservabilityRouteDeps,
): void {
	const { router, analyticsAggregator, analyticsReader, requestLogger } = deps;

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

	app.get("/v1/analytics", async (c) => {
		try {
			if (!analyticsAggregator) {
				return c.json({ error: "Analytics not enabled" }, 503);
			}

			const dimension = (c.req.query("dimension") ?? "hourly") as AnalyticsDimension;
			const fromStr = c.req.query("from");
			const toStr = c.req.query("to");
			const channelId = c.req.query("channelId") || undefined;
			const provider = c.req.query("provider") || undefined;
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

			const liveData = analyticsAggregator.query({
				dimension,
				from,
				to,
				channelId,
				provider,
				model,
			});
			const persistedData =
				(dimension === "hourly" || dimension === "daily") && analyticsReader
					? await analyticsReader.query({ dimension, from, to })
					: [];
			const data =
				persistedData.length > 0 || (dimension === "hourly" || dimension === "daily")
					? mergeTimeSeriesData(persistedData, liveData)
					: liveData;
			const source = getAnalyticsSource(dimension, persistedData.length, liveData.length);

			const totalRequests = data.reduce((sum, item) => sum + item.requests, 0);
			const successfulRequests = data.reduce((sum, item) => sum + item.successfulRequests, 0);
			const failedRequests = data.reduce((sum, item) => sum + item.failedRequests, 0);
			const retriedRequests = data.reduce((sum, item) => sum + item.retriedRequests, 0);
			const totalTokens = data.reduce(
				(sum, item) => sum + item.totalTokens,
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
			const errorRate = totalRequests > 0 ? roundRate(failedRequests / totalRequests) : 0;
			const retryRate = totalRequests > 0 ? roundRate(retriedRequests / totalRequests) : 0;

			return c.json({
				data,
				dimension,
				source,
				flushStatus: analyticsAggregator.getFlushStatus(),
				summary: {
					totalRequests,
					successfulRequests,
					failedRequests,
					retriedRequests,
					totalTokens,
					totalCost,
					avgLatency,
					errorRate,
					retryRate,
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
