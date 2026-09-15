import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { AnalyticsAggregator, SQLiteAnalyticsReader, SQLiteAnalyticsWriter } from "../../src/analytics/index.js";
import { MigrationRunner } from "../../src/db/migrate.js";

describe("SQLiteAnalyticsWriter", () => {
	let runner: MigrationRunner;

	beforeEach(async () => {
		runner = new MigrationRunner({ dbPath: ":memory:" });
		await runner.runMigration(2);
		await runner.runMigration(9);
		await runner.runMigration(11);
	});

	afterEach(() => {
		runner.close();
	});

	it("upserts hourly and daily aggregates without creating duplicates", async () => {
		const writer = new SQLiteAnalyticsWriter(runner.getDatabase());
		const hour = 1_717_200_000_000;
		const day = 1_717_171_200_000;

		await writer.upsert({
			flushedAt: Date.now(),
			hourly: [
				{
					timestamp: hour,
					data: {
						timestamp: hour,
						requests: 2,
						successfulRequests: 1,
						failedRequests: 1,
						retriedRequests: 1,
						totalTokens: 300,
						inputTokens: 200,
						outputTokens: 100,
						cost: 0.5,
						avgLatency: 150,
						p95Latency: 200,
						p99Latency: 250,
						errorRate: 0.5,
						retryRate: 0.5,
					},
				},
			],
			daily: [
				{
					timestamp: day,
					data: {
						timestamp: day,
						requests: 3,
						successfulRequests: 2,
						failedRequests: 1,
						retriedRequests: 1,
						totalTokens: 500,
						inputTokens: 300,
						outputTokens: 200,
						cost: 1.25,
						avgLatency: 180,
						errorRate: 0.3333,
						retryRate: 0.3333,
					},
				},
			],
		});

		await writer.upsert({
			flushedAt: Date.now(),
			hourly: [
				{
					timestamp: hour,
					data: {
						timestamp: hour,
						requests: 5,
						successfulRequests: 3,
						failedRequests: 2,
						retriedRequests: 2,
						totalTokens: 700,
						inputTokens: 450,
						outputTokens: 250,
						cost: 0.75,
						avgLatency: 175,
						p95Latency: 220,
						p99Latency: 275,
						errorRate: 0.4,
						retryRate: 0.4,
					},
				},
			],
			daily: [
				{
					timestamp: day,
					data: {
						timestamp: day,
						requests: 8,
						successfulRequests: 5,
						failedRequests: 3,
						retriedRequests: 2,
						totalTokens: 900,
						inputTokens: 500,
						outputTokens: 400,
						cost: 2.0,
						avgLatency: 210,
						p95Latency: 300,
						p99Latency: 350,
						errorRate: 0.375,
						retryRate: 0.25,
					},
				},
			],
		});

		const db = runner.getDatabase();
		const hourlyRows = db.prepare("SELECT * FROM analytics_hourly").all() as Array<Record<string, number>>;
		const dailyRows = db.prepare("SELECT * FROM analytics_daily").all() as Array<Record<string, number>>;

		assert.equal(hourlyRows.length, 1);
		assert.equal(dailyRows.length, 1);

		assert.equal(hourlyRows[0]?.hour, hour);
		assert.equal(hourlyRows[0]?.requests, 5);
		assert.equal(hourlyRows[0]?.successful_requests, 3);
		assert.equal(hourlyRows[0]?.failed_requests, 2);
		assert.equal(hourlyRows[0]?.retried_requests, 2);
		assert.equal(hourlyRows[0]?.total_tokens, 700);
		assert.equal(hourlyRows[0]?.input_tokens, 450);
		assert.equal(hourlyRows[0]?.output_tokens, 250);
		assert.equal(hourlyRows[0]?.avg_latency_ms, 175);
		assert.equal(hourlyRows[0]?.p95_latency_ms, 220);
		assert.equal(hourlyRows[0]?.p99_latency_ms, 275);

		assert.equal(dailyRows[0]?.day, day);
		assert.equal(dailyRows[0]?.requests, 8);
		assert.equal(dailyRows[0]?.successful_requests, 5);
		assert.equal(dailyRows[0]?.failed_requests, 3);
		assert.equal(dailyRows[0]?.retried_requests, 2);
		assert.equal(dailyRows[0]?.total_tokens, 900);
		assert.equal(dailyRows[0]?.input_tokens, 500);
		assert.equal(dailyRows[0]?.output_tokens, 400);
		assert.equal(dailyRows[0]?.avg_latency_ms, 210);
		assert.equal(dailyRows[0]?.p95_latency_ms, 300);
		assert.equal(dailyRows[0]?.p99_latency_ms, 350);
	});

	it("reads persisted hourly and daily aggregates in AggregatedDataPoint shape", async () => {
		const db = runner.getDatabase();
		const writer = new SQLiteAnalyticsWriter(db);
		const reader = new SQLiteAnalyticsReader(db);
		const hour = 1_717_200_000_000;
		const day = 1_717_171_200_000;

		await writer.upsert({
			flushedAt: Date.now(),
			hourly: [
				{
					timestamp: hour,
					data: {
						timestamp: hour,
						requests: 4,
						successfulRequests: 3,
						failedRequests: 1,
						retriedRequests: 2,
						totalTokens: 320,
						inputTokens: 200,
						outputTokens: 120,
						cost: 0.42,
						avgLatency: 140,
						p95Latency: 180,
						errorRate: 0.25,
						retryRate: 0.5,
					},
				},
			],
			daily: [
				{
					timestamp: day,
					data: {
						timestamp: day,
						requests: 7,
						successfulRequests: 5,
						failedRequests: 2,
						retriedRequests: 3,
						totalTokens: 500,
						inputTokens: 300,
						outputTokens: 200,
						cost: 1.5,
						avgLatency: 210,
						errorRate: 0.2857,
						retryRate: 0.4286,
					},
				},
			],
		});

		const hourly = reader.query({ dimension: "hourly" });
		const daily = reader.query({ dimension: "daily" });

		assert.deepEqual(hourly, [
			{
				timestamp: hour,
				requests: 4,
				successfulRequests: 3,
				failedRequests: 1,
				retriedRequests: 2,
				totalTokens: 320,
				inputTokens: 200,
				outputTokens: 120,
				cost: 0.42,
				avgLatency: 140,
				p95Latency: 180,
				errorRate: 0.25,
				retryRate: 0.5,
			},
		]);

		assert.deepEqual(daily, [
			{
				timestamp: day,
				requests: 7,
				successfulRequests: 5,
				failedRequests: 2,
				retriedRequests: 3,
				totalTokens: 500,
				inputTokens: 300,
				outputTokens: 200,
				cost: 1.5,
				avgLatency: 210,
				errorRate: 0.2857142857142857,
				retryRate: 0.42857142857142855,
			},
		]);
	});

	it("preserves durable totalTokens when input/output splits are unknown", async () => {
		const db = runner.getDatabase();
		const writer = new SQLiteAnalyticsWriter(db);
		const reader = new SQLiteAnalyticsReader(db);
		const hour = 1_717_200_000_000;
		const day = 1_717_171_200_000;

		await writer.upsert({
			flushedAt: Date.now(),
			hourly: [
				{
					timestamp: hour,
					data: {
						timestamp: hour,
						requests: 1,
						successfulRequests: 1,
						failedRequests: 0,
						retriedRequests: 0,
						totalTokens: 17,
						inputTokens: 0,
						outputTokens: 0,
						cost: 0,
						avgLatency: 321,
						errorRate: 0,
						retryRate: 0,
					},
				},
			],
			daily: [
				{
					timestamp: day,
					data: {
						timestamp: day,
						requests: 1,
						successfulRequests: 1,
						failedRequests: 0,
						retriedRequests: 0,
						totalTokens: 17,
						inputTokens: 0,
						outputTokens: 0,
						cost: 0,
						avgLatency: 321,
						errorRate: 0,
						retryRate: 0,
					},
				},
			],
		});

		const hourlyRow = db.prepare("SELECT total_tokens, input_tokens, output_tokens FROM analytics_hourly WHERE hour = ?").get(hour) as Record<string, number>;
		const dailyRow = db.prepare("SELECT total_tokens, input_tokens, output_tokens FROM analytics_daily WHERE day = ?").get(day) as Record<string, number>;

		assert.equal(hourlyRow.total_tokens, 17);
		assert.equal(hourlyRow.input_tokens, 0);
		assert.equal(hourlyRow.output_tokens, 0);
		assert.equal(dailyRow.total_tokens, 17);
		assert.equal(dailyRow.input_tokens, 0);
		assert.equal(dailyRow.output_tokens, 0);

		assert.equal(reader.query({ dimension: "hourly" })[0]?.totalTokens, 17);
		assert.equal(reader.query({ dimension: "daily" })[0]?.totalTokens, 17);
	});

	it("expires old aggregates after the production persistence boundary completes", async () => {
		const db = runner.getDatabase();
		const writer = new SQLiteAnalyticsWriter(db);
		const cutoff = Date.parse("2024-02-01T00:00:00Z");

		await writer.upsert({
			flushedAt: cutoff - 31 * 24 * 60 * 60 * 1000,
			hourly: [{ timestamp: cutoff - 31 * 24 * 60 * 60 * 1000, data: analyticsPoint() }],
			daily: [],
		});
		const aggregator = new AnalyticsAggregator({ persistenceWriter: writer, flushIntervalMs: 60_000 });
		aggregator.record("openai", "gpt-4o", {
			channel: "gateway",
			latencyMs: 1,
			timestamp: cutoff,
		});
		await aggregator.flush();
		await aggregator.destroy();

		const rows = db.prepare("SELECT hour FROM analytics_hourly ORDER BY hour").all() as Array<{ hour: number }>;
		assert.deepEqual(rows, []);
	});

	it("rejects sensitive direct-writer metadata before any aggregate is persisted", async () => {
		const db = runner.getDatabase();
		const writer = new SQLiteAnalyticsWriter(db);
		const canaries = [
			"WU3-PLAIN-CANARY", "WU3-NESTED-CANARY", "WU3-RENAMED-CANARY",
			"V1UzLUJBU0U2NC1DQU5BUlk=", "WU3-ESCAPED-\\u0063ANARY", "WU3-UNICODE-秘密",
			`${"x".repeat(9_990)}WU3-TRUNCATION-CANARY`,
		];

		for (const canary of canaries) {
			await assert.rejects(writer.upsert({
				flushedAt: Date.now(),
				hourly: [{
					timestamp: Date.now(),
					data: { requests: 1, successfulRequests: 1, failedRequests: 0, retriedRequests: 0,
						totalTokens: 1, inputTokens: 1, outputTokens: 0, cost: 0, avgLatency: 1,
						errorRate: 0, retryRate: 0, renamedPayload: canary } as never,
				}],
				daily: [],
			}), /Telemetry sink input rejected/);
		}

		const row = db.prepare("SELECT COUNT(*) AS count FROM analytics_hourly").get() as { count: number };
		assert.equal(row.count, 0);
	});
});

function analyticsPoint() {
	return {
		timestamp: 0,
		requests: 1,
		successfulRequests: 1,
		failedRequests: 0,
		retriedRequests: 0,
		totalTokens: 1,
		inputTokens: 1,
		outputTokens: 0,
		cost: 0,
		avgLatency: 1,
		errorRate: 0,
		retryRate: 0,
	};
}
