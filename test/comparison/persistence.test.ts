/**
 * Tests for ComparisonStore persistence layer.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import type { CompareResponse } from "../../src/comparison/index.js";
import { ComparisonStore } from "../../src/comparison/persistence.js";
import { RequestLogger } from "../../src/logging/request-logger.js";
import { ProfileEnforcer } from "../../src/security/enforcer.js";

function createTestDb(): { db: Database.Database; path: string } {
	const path = join(tmpdir(), `mlb-comparison-test-${randomUUID()}.db`);
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	return { db, path };
}

function makeCompareResponse(
	overrides: Partial<CompareResponse> = {},
): CompareResponse {
	return {
		id: randomUUID(),
		prompt: "What is 2+2?",
		results: [
			{
				model: "gpt-4",
				provider: "openai",
				status: "success",
				response: "The answer is 4.",
				tokensIn: 10,
				tokensOut: 5,
				costUsd: 0.001,
				latencyMs: 300,
				finishReason: "stop",
			},
			{
				model: "claude-3-opus",
				provider: "anthropic",
				status: "success",
				response: "4",
				tokensIn: 8,
				tokensOut: 2,
				costUsd: 0.0005,
				latencyMs: 200,
				finishReason: "stop",
			},
		],
		summary: {
			fastestModel: "claude-3-opus",
			cheapestModel: "claude-3-opus",
			totalCost: 0.0015,
			wallClockMs: 300,
		},
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

describe("ComparisonStore", () => {
	let db: Database.Database;
	let dbPath: string;
	let store: ComparisonStore;

	beforeEach(() => {
		const result = createTestDb();
		db = result.db;
		dbPath = result.path;
		store = new ComparisonStore(
			db,
			new ProfileEnforcer("local-dev").issueComparisonCapability("*")!,
		);
	});

	afterEach(() => {
		db.close();
		try {
			unlinkSync(dbPath);
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(dbPath + "-wal");
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(dbPath + "-shm");
		} catch {
			/* ignore */
		}
	});

	it("save + query round-trip", () => {
		const response = makeCompareResponse();
		store.save(response, "system prompt", ["gpt-4", "claude-3-opus"]);

		const results = store.query();
		assert.equal(results.length, 1);
		assert.equal(results[0]!.id, response.id);
		assert.equal(results[0]!.prompt, response.prompt);
		assert.equal(results[0]!.results.length, 2);
		assert.equal(results[0]!.summary.totalCost, response.summary.totalCost);
	});

	it("getById returns the saved comparison", () => {
		const response = makeCompareResponse();
		store.save(response);

		const found = store.getById(response.id);
		assert.ok(found !== null);
		assert.equal(found!.id, response.id);
		assert.equal(found!.prompt, response.prompt);
	});

	it("getById returns null for unknown id", () => {
		const found = store.getById(randomUUID());
		assert.equal(found, null);
	});

	it("project filtering — only returns matching project", () => {
		const r1 = makeCompareResponse({ id: randomUUID() });
		const r2 = makeCompareResponse({ id: randomUUID() });

		store.save(r1, undefined, undefined, "project-a");
		store.save(r2, undefined, undefined, "project-b");

		const projectA = store.query({ project: "project-a" });
		assert.equal(projectA.length, 1);
		assert.equal(projectA[0]!.id, r1.id);

		const projectB = store.query({ project: "project-b" });
		assert.equal(projectB.length, 1);
		assert.equal(projectB[0]!.id, r2.id);
	});

	it("limit pagination — respects limit", () => {
		for (let i = 0; i < 5; i++) {
			store.save(makeCompareResponse({ id: randomUUID() }));
		}

		const limited = store.query({ limit: 3 });
		assert.equal(limited.length, 3);
	});

	it("offset pagination — skips first N results", () => {
		const ids: string[] = [];
		for (let i = 0; i < 4; i++) {
			const id = randomUUID();
			ids.push(id);
			// slight delay to ensure distinct created_at ordering
			store.save(
				makeCompareResponse({
					id,
					createdAt: new Date(Date.now() - (3 - i) * 1000).toISOString(),
				}),
			);
		}

		const all = store.query({ limit: 10 });
		assert.equal(all.length, 4);

		const page2 = store.query({ limit: 2, offset: 2 });
		assert.equal(page2.length, 2);
		// page2 results should be different from first 2
		const firstPage = store.query({ limit: 2, offset: 0 });
		assert.notEqual(page2[0]!.id, firstPage[0]!.id);
	});

	it("empty results — returns empty array", () => {
		const results = store.query();
		assert.equal(results.length, 0);

		const filtered = store.query({ project: "nonexistent" });
		assert.equal(filtered.length, 0);
	});

	it("limit is capped at 100", () => {
		for (let i = 0; i < 5; i++) {
			store.save(makeCompareResponse({ id: randomUUID() }));
		}
		// limit=200 should be silently capped to 100
		const results = store.query({ limit: 200 });
		assert.ok(results.length <= 100);
		assert.equal(results.length, 5); // only 5 records exist
	});

	it("denies persistence without the explicit comparison capability", () => {
		const unauthorized = new ComparisonStore(db);
		assert.throws(() => unauthorized.save(makeCompareResponse()));
		assert.equal((db.prepare("SELECT count(*) AS count FROM comparison_results").get() as { count: number }).count, 0);
	});

	it("keeps a legacy identifier indistinguishable from an unknown identifier", () => {
		db.exec("CREATE TABLE comparison_results_legacy (id TEXT PRIMARY KEY, prompt TEXT)");
		db.prepare("INSERT INTO comparison_results_legacy VALUES (?, ?)").run("legacy-id", "private-canary");
		assert.equal(store.getById("legacy-id"), null);
		assert.equal(store.getById("unknown-id"), null);
	});

	it("keeps comparison content canaries out of ordinary telemetry and readback", async () => {
		const canaries = {
			prompt: "COMPARISON-PROMPT-CANARY",
			systemPrompt: "COMPARISON-SYSTEM-PROMPT-CANARY",
			response: "COMPARISON-RESPONSE-CANARY",
			summary: "COMPARISON-SUMMARY-CANARY",
		};
		const response = makeCompareResponse({
			prompt: canaries.prompt,
			results: [{ ...makeCompareResponse().results[0]!, response: canaries.response }],
			summary: { totalCost: 0, wallClockMs: 1, fastestModel: canaries.summary },
		});
		store.save(response, canaries.systemPrompt);

		const ordinary = db.prepare("SELECT models, project, created_at FROM comparison_results WHERE id = ?").get(response.id);
		assert.equal(JSON.stringify(ordinary).includes("COMPARISON-"), false);
		const authorized = db.prepare("SELECT prompt, system_prompt, results, summary FROM authorized_comparison_results WHERE id = ?").get(response.id);
		for (const canary of Object.values(canaries)) assert.equal(JSON.stringify(authorized).includes(canary), true);

		db.exec(`CREATE TABLE request_logs (
			id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
			correlation_id TEXT, total_tokens INTEGER, input_tokens INTEGER, output_tokens INTEGER, cost REAL,
			latency_ms INTEGER, attempts INTEGER NOT NULL DEFAULT 1, error TEXT, error_code TEXT, error_category TEXT
		)`);
		const ordinaryReadback = await new RequestLogger(db).getLogs({});
		assert.deepEqual(ordinaryReadback.logs, []);
		assert.equal(ordinaryReadback.total, 0);
	});
});
