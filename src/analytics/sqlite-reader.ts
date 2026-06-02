import type Database from "better-sqlite3";

import {
	type AggregatedDataPoint,
	type AnalyticsPersistenceReader,
	type DurableAnalyticsQuery,
	DURABLE_ANALYTICS_DIMENSIONS,
} from "./types.js";

interface PersistedAnalyticsQueryRow {
	timestamp: number;
	requests: number;
	successfulRequests: number;
	failedRequests: number;
	retriedRequests: number;
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	avgLatency: number | null;
	p95Latency: number | null;
	p99Latency: number | null;
}

export class SQLiteAnalyticsReader implements AnalyticsPersistenceReader {
	constructor(private readonly db: Database.Database) {}

	query(query: DurableAnalyticsQuery): AggregatedDataPoint[] {
		const { tableName, timestampColumn } = this.getTableConfig(query.dimension);
		const conditions: string[] = [];
		const params: number[] = [];

		if (query.from !== undefined) {
			conditions.push(`${timestampColumn} >= ?`);
			params.push(query.from);
		}

		if (query.to !== undefined) {
			conditions.push(`${timestampColumn} <= ?`);
			params.push(query.to);
		}

		const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`
				SELECT
					${timestampColumn} AS timestamp,
					requests,
					successful_requests AS successfulRequests,
					failed_requests AS failedRequests,
					retried_requests AS retriedRequests,
					total_tokens AS totalTokens,
					input_tokens AS inputTokens,
					output_tokens AS outputTokens,
					cost,
					avg_latency_ms AS avgLatency,
					p95_latency_ms AS p95Latency,
					p99_latency_ms AS p99Latency
				FROM ${tableName}${whereClause}
				ORDER BY ${timestampColumn} ASC
			`)
			.all(...params) as PersistedAnalyticsQueryRow[];

		return rows.map((row) => this.toDataPoint(row));
	}

	private getTableConfig(dimension: DurableAnalyticsQuery["dimension"]): {
		tableName: "analytics_hourly" | "analytics_daily";
		timestampColumn: "hour" | "day";
	} {
		if (dimension === DURABLE_ANALYTICS_DIMENSIONS.HOURLY) {
			return {
				tableName: "analytics_hourly",
				timestampColumn: "hour",
			};
		}

		return {
			tableName: "analytics_daily",
			timestampColumn: "day",
		};
	}

	private toDataPoint(row: PersistedAnalyticsQueryRow): AggregatedDataPoint {
		const point: AggregatedDataPoint = {
			timestamp: row.timestamp,
			requests: row.requests,
			successfulRequests: row.successfulRequests,
			failedRequests: row.failedRequests,
			retriedRequests: row.retriedRequests,
			totalTokens: row.totalTokens,
			inputTokens: row.inputTokens,
			outputTokens: row.outputTokens,
			cost: row.cost,
			avgLatency: row.avgLatency ?? 0,
			errorRate: row.requests > 0 ? row.failedRequests / row.requests : 0,
			retryRate: row.requests > 0 ? row.retriedRequests / row.requests : 0,
		};

		if (row.p95Latency !== null) {
			point.p95Latency = row.p95Latency;
		}

		if (row.p99Latency !== null) {
			point.p99Latency = row.p99Latency;
		}

		return point;
	}
}
