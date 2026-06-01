import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { SQLiteAnalyticsReader, SQLiteAnalyticsWriter } from "../../src/analytics/index.js";
import { MigrationRunner } from "../../src/db/migrate.js";

describe("SQLiteAnalyticsWriter", () => {
	let runner: MigrationRunner;

	beforeEach(async () => {
		runner = new MigrationRunner({ dbPath: ":memory:" });
		await runner.runMigration(2);
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
						totalTokens: 300,
						inputTokens: 200,
						outputTokens: 100,
						cost: 0.5,
						avgLatency: 150,
						p95Latency: 200,
						p99Latency: 250,
					},
				},
			],
			daily: [
				{
					timestamp: day,
					data: {
						timestamp: day,
						requests: 3,
						totalTokens: 500,
						inputTokens: 300,
						outputTokens: 200,
						cost: 1.25,
						avgLatency: 180,
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
						totalTokens: 700,
						inputTokens: 450,
						outputTokens: 250,
						cost: 0.75,
						avgLatency: 175,
						p95Latency: 220,
						p99Latency: 275,
					},
				},
			],
			daily: [
				{
					timestamp: day,
					data: {
						timestamp: day,
						requests: 8,
						totalTokens: 900,
						inputTokens: 500,
						outputTokens: 400,
						cost: 2.0,
						avgLatency: 210,
						p95Latency: 300,
						p99Latency: 350,
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
		assert.equal(hourlyRows[0]?.input_tokens, 450);
		assert.equal(hourlyRows[0]?.output_tokens, 250);
		assert.equal(hourlyRows[0]?.avg_latency_ms, 175);
		assert.equal(hourlyRows[0]?.p95_latency_ms, 220);
		assert.equal(hourlyRows[0]?.p99_latency_ms, 275);

		assert.equal(dailyRows[0]?.day, day);
		assert.equal(dailyRows[0]?.requests, 8);
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
						totalTokens: 320,
						inputTokens: 200,
						outputTokens: 120,
						cost: 0.42,
						avgLatency: 140,
						p95Latency: 180,
					},
				},
			],
			daily: [
				{
					timestamp: day,
					data: {
						timestamp: day,
						requests: 7,
						totalTokens: 500,
						inputTokens: 300,
						outputTokens: 200,
						cost: 1.5,
						avgLatency: 210,
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
				totalTokens: 320,
				inputTokens: 200,
				outputTokens: 120,
				cost: 0.42,
				avgLatency: 140,
				p95Latency: 180,
			},
		]);

		assert.deepEqual(daily, [
			{
				timestamp: day,
				requests: 7,
				totalTokens: 500,
				inputTokens: 300,
				outputTokens: 200,
				cost: 1.5,
				avgLatency: 210,
			},
		]);
	});
});
