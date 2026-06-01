import type Database from "better-sqlite3";

import type { AggregatedDataPoint, AnalyticsPersistenceData, AnalyticsPersistenceWriter } from "./types.js";

interface PersistedAnalyticsRow {
	hour?: number;
	day?: number;
	requests: number;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	avgLatencyMs: number;
	p95LatencyMs: number | null;
	p99LatencyMs: number | null;
}

export class SQLiteAnalyticsWriter implements AnalyticsPersistenceWriter {
	private readonly upsertHourly: Database.Statement;
	private readonly upsertDaily: Database.Statement;

	constructor(private readonly db: Database.Database) {
		this.upsertHourly = this.db.prepare(`
			INSERT INTO analytics_hourly (
				hour,
				requests,
				input_tokens,
				output_tokens,
				cost,
				avg_latency_ms,
				p95_latency_ms,
				p99_latency_ms
			) VALUES (
				@hour,
				@requests,
				@inputTokens,
				@outputTokens,
				@cost,
				@avgLatencyMs,
				@p95LatencyMs,
				@p99LatencyMs
			)
			ON CONFLICT(hour) DO UPDATE SET
				requests = excluded.requests,
				input_tokens = excluded.input_tokens,
				output_tokens = excluded.output_tokens,
				cost = excluded.cost,
				avg_latency_ms = excluded.avg_latency_ms,
				p95_latency_ms = excluded.p95_latency_ms,
				p99_latency_ms = excluded.p99_latency_ms
		`);

		this.upsertDaily = this.db.prepare(`
			INSERT INTO analytics_daily (
				day,
				requests,
				input_tokens,
				output_tokens,
				cost,
				avg_latency_ms,
				p95_latency_ms,
				p99_latency_ms
			) VALUES (
				@day,
				@requests,
				@inputTokens,
				@outputTokens,
				@cost,
				@avgLatencyMs,
				@p95LatencyMs,
				@p99LatencyMs
			)
			ON CONFLICT(day) DO UPDATE SET
				requests = excluded.requests,
				input_tokens = excluded.input_tokens,
				output_tokens = excluded.output_tokens,
				cost = excluded.cost,
				avg_latency_ms = excluded.avg_latency_ms,
				p95_latency_ms = excluded.p95_latency_ms,
				p99_latency_ms = excluded.p99_latency_ms
		`);

	}

	async upsert(data: AnalyticsPersistenceData): Promise<void> {
		if (data.hourly.length > 0) {
			this.db.transaction((rows: PersistedAnalyticsRow[]) => {
				for (const row of rows) {
					this.upsertHourly.run(row);
				}
			})(
				data.hourly.map(({ timestamp, data: point }) => ({
					hour: timestamp,
					...this.toRow(point),
				})),
			);
		}

		if (data.daily.length > 0) {
			this.db.transaction((rows: PersistedAnalyticsRow[]) => {
				for (const row of rows) {
					this.upsertDaily.run(row);
				}
			})(
				data.daily.map(({ timestamp, data: point }) => ({
					day: timestamp,
					...this.toRow(point),
				})),
			);
		}
	}

	private toRow(point: AggregatedDataPoint): Omit<PersistedAnalyticsRow, "hour" | "day"> {
		return {
			requests: point.requests,
			inputTokens: point.inputTokens,
			outputTokens: point.outputTokens,
			cost: point.cost,
			avgLatencyMs: point.avgLatency,
			p95LatencyMs: point.p95Latency ?? null,
			p99LatencyMs: point.p99Latency ?? null,
		};
	}
}
