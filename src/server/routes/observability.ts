import type { Context, Hono } from "hono";

import type {
	AggregatedDataPoint,
	AnalyticsAggregator,
	AnalyticsPersistenceReader,
} from "../../analytics/index.js";
import {
	getMetrics,
	getMetricsContentType,
	MetricsRetentionError,
	updateProviderAvailability,
} from "../../core/metrics.js";
import type { Router } from "../../core/router.js";
import { safeError, toSafeHttpError } from "../../core/safe-error.js";
import { normalizeTelemetryFailure } from "../../core/telemetry-failure.js";
import { LogQuerySchema } from "../../logging/schemas.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import { getRetentionProvenance, type ExternalRetentionBackend } from "../../telemetry/retention.js";
import type { ReadbackScopeAuthorizer } from "./usage.js";

const VALID_ANALYTICS_DIMENSIONS = ["total", "hourly", "daily", "channel", "provider", "model"] as const;

const INTERNAL_ERROR_MESSAGE = toSafeHttpError(safeError("INTERNAL_ERROR")).body.error;
const VALIDATION_ERROR_MESSAGE = toSafeHttpError(safeError("INVALID_REQUEST")).body.error;
const LOG_VALIDATION_FIELDS = [
	"from", "to", "provider", "model", "correlationId", "status", "minLatencyMs", "limit", "offset",
] as const;

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
	authorizeReadback?: ReadbackScopeAuthorizer;
	metricsRetentionBackend?: ExternalRetentionBackend;
}

export function registerObservabilityRoutes(
	app: Hono,
	deps: ObservabilityRouteDeps,
): void {
	const {
		router,
		analyticsAggregator,
		analyticsReader,
		requestLogger,
		authorizeReadback,
		metricsRetentionBackend,
	} = deps;

	app.get("/v1/logs", async (c) => {
		try {
			if (!authorizeReadback?.(c.req.header("X-Telemetry-Scope"))) return denied(c);
			if (!requestLogger) {
				return c.json({ error: "Request logging not enabled" }, 503);
			}

			const query = LogQuerySchema.safeParse(c.req.query());
			if (!query.success) {
				const path = query.error.issues[0]?.path;
				const field = path?.length === 1
					? LOG_VALIDATION_FIELDS.find((allowed) => allowed === path[0]) ?? ""
					: "";
				return c.json(
					{ error: VALIDATION_ERROR_MESSAGE, code: "VALIDATION_ERROR", field },
					400,
				);
			}

			const logs = await requestLogger.getLogs(query.data);
			return c.json({
				logs: logs.logs.map((log) => ({
					id: `log_${log.id}`,
					timestamp: log.timestamp,
					provider: log.provider,
					model: log.model,
					totalTokens: log.totalTokens,
					inputTokens: log.inputTokens,
					outputTokens: log.outputTokens,
					cost: log.cost,
					latencyMs: log.latencyMs,
					error: log.error ? normalizeTelemetryFailure(log.error).compatibilityText : undefined,
					attempts: log.attempts,
				})),
				total: logs.total,
				limit: logs.limit,
				offset: logs.offset,
			});
		} catch {
			return c.json({ error: INTERNAL_ERROR_MESSAGE }, 500);
		}
	});

	app.get("/metrics", async (c) => {
		if (!authorizeReadback?.(c.req.header("X-Telemetry-Scope"))) return denied(c);
		try {
			await updateProviderAvailability(router);
			const metrics = await getMetrics(metricsRetentionBackend);
			return c.text(metrics, 200, { "Content-Type": getMetricsContentType() });
		} catch (error) {
			if (error instanceof MetricsRetentionError) {
				return c.json({ error: INTERNAL_ERROR_MESSAGE }, 503);
			}
			return c.json({ error: INTERNAL_ERROR_MESSAGE }, 500);
		}
	});

	app.get("/v1/retention", (c) => {
		if (!authorizeReadback?.(c.req.header("X-Telemetry-Scope"))) return denied(c);
		return c.json(getRetentionProvenance());
	});

	app.get("/v1/analytics", async (c) => {
		try {
			if (!authorizeReadback?.(c.req.header("X-Telemetry-Scope"))) return denied(c);
			if (!analyticsAggregator) {
				return c.json({ error: "Analytics not enabled" }, 503);
			}

			const rawDimension = c.req.query("dimension") ?? "hourly";
			const dimension = VALID_ANALYTICS_DIMENSIONS.find((allowed) => allowed === rawDimension);
			const fromStr = c.req.query("from");
			const toStr = c.req.query("to");
			const channelId = c.req.query("channelId") || undefined;
			const provider = c.req.query("provider") || undefined;
			const model = c.req.query("model") || undefined;

			if (dimension === undefined || dimension === "channel") {
				return c.json(
					{
						error: "INVALID_PARAMS",
						message: rawDimension === "week" ? "Invalid dimension: week" : "Invalid dimension",
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
				(dimension === "hourly" || dimension === "daily") && analyticsReader?.queryRetained
					? await analyticsReader.queryRetained({ dimension, from, to })
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
				data: data.map(projectAnalyticsPoint),
				dimension,
				source,
				flushStatus: projectFlushStatus(analyticsAggregator.getFlushStatus()),
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
		} catch {
			return c.json({ error: INTERNAL_ERROR_MESSAGE }, 500);
		}
	});

	app.get("/v1/compression/stats", async (c) => {
		try {
			const { compressionStats } = await import("../../context-compression/output-compression.js");
			return c.json(compressionStats.getSummary());
		} catch {
			return c.json({ error: INTERNAL_ERROR_MESSAGE }, 500);
		}
	});
}

function denied(c: Context) {
	const safe = toSafeHttpError(safeError("ACCESS_DENIED"));
	return c.json(safe.body, 403);
}

function projectAnalyticsPoint(point: AggregatedDataPoint) {
	return {
		timestamp: point.timestamp,
		...(point.provider ? { provider: point.provider } : {}),
		...(point.model ? { model: point.model } : {}),
		requests: point.requests,
		successfulRequests: point.successfulRequests,
		failedRequests: point.failedRequests,
		retriedRequests: point.retriedRequests,
		totalTokens: point.totalTokens,
		inputTokens: point.inputTokens,
		outputTokens: point.outputTokens,
		cost: point.cost,
		avgLatency: point.avgLatency,
		...(point.p95Latency === undefined ? {} : { p95Latency: point.p95Latency }),
		...(point.p99Latency === undefined ? {} : { p99Latency: point.p99Latency }),
		errorRate: point.errorRate,
		retryRate: point.retryRate,
	};
}

function projectFlushStatus(status: ReturnType<AnalyticsAggregator["getFlushStatus"]>) {
	return {
		persistenceEnabled: status.persistenceEnabled,
		lastFlushAt: status.lastFlushAt,
		lastFlushSucceededAt: status.lastFlushSucceededAt,
		pendingInMemoryBuckets: status.pendingInMemoryBuckets,
		hasUnflushedData: status.hasUnflushedData,
	};
}
