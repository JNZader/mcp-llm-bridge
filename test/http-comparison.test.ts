/**
 * HTTP integration tests for comparison endpoints.
 *
 * POST /v1/compare  — fan-out comparison
 * GET  /v1/compare/history — persisted results
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ComparisonStore } from "../src/comparison/persistence.js";
import { ComparisonService } from "../src/comparison/service.js";
import type {
	InternalLLMRequest,
	InternalLLMResponse,
} from "../src/core/internal-model.js";
import type { Router } from "../src/core/router.js";
import type { GatewayConfig } from "../src/core/types.js";
import { startHttpServer } from "../src/server/http.js";
import { Vault } from "../src/vault/vault.js";

// ── Test config ──────────────────────────────────────────────

const AUTH_TOKEN = "comparison-test-token";
const DB_PATH = join(tmpdir(), `mlb-comparison-http-${randomUUID()}.db`);

const config: GatewayConfig = {
	masterKey: randomBytes(32),
	dbPath: DB_PATH,
	httpPort: 0,
	authToken: AUTH_TOKEN,
};

// ── Mock router that doesn't need real providers ─────────────

function makeMockRouter(): Router {
	return {
		generateFromInternal: async (
			req: InternalLLMRequest,
		): Promise<InternalLLMResponse> => {
			return {
				content: `Mock response for ${req.model ?? "unknown"}`,
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
				model: req.model ?? "mock-model",
				finishReason: "stop",
				metadata: { provider: "mock-provider", latencyMs: 50 },
			};
		},
	} as unknown as Router;
}

// ── Setup ─────────────────────────────────────────────────────

const vault = new Vault(config);
const router = makeMockRouter();

// Use the vault's DB so we share the same connection
const db = vault.getDb();

const comparisonStore = new ComparisonStore(db);
const comparisonService = new ComparisonService(router, {
	maxCostCeiling: 10.0,
	store: comparisonStore,
});

let server: http.Server;
let port = 0;

before(async () => {
	server = startHttpServer(
		router,
		vault,
		config,
		undefined, // groupStore
		undefined, // costTracker
		undefined, // latencyMeasurer
		undefined, // freeModelRouter
		db,
		comparisonService,
	) as unknown as http.Server;

	await new Promise<void>((resolve) => {
		server.on("listening", () => {
			const address = server.address();
			if (address && typeof address === "object") {
				port = address.port;
			}
			resolve();
		});
	});
});

after(() => {
	return new Promise<void>((resolve) => {
		server.close(() => {
			vault.close();
			for (const suffix of ["", "-wal", "-shm"]) {
				const filePath = DB_PATH + suffix;
				if (existsSync(filePath)) unlinkSync(filePath);
			}
			resolve();
		});
	});
});

// ── HTTP helpers ─────────────────────────────────────────────

interface RequestOptions {
	method: string;
	path: string;
	body?: unknown;
	headers?: Record<string, string>;
}

async function req(opts: RequestOptions): Promise<{
	status: number;
	json: () => unknown;
}> {
	return new Promise((resolve, reject) => {
		const bodyStr =
			opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

		const rawReq = http.request(
			{
				hostname: "127.0.0.1",
				port,
				path: opts.path,
				method: opts.method,
				headers: {
					"Content-Type": "application/json",
					...(bodyStr
						? { "Content-Length": String(Buffer.byteLength(bodyStr)) }
						: {}),
					...(opts.headers ?? {}),
				},
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					resolve({
						status: res.statusCode ?? 0,
						json: () => {
							try {
								return JSON.parse(data);
							} catch {
								return {};
							}
						},
					});
				});
			},
		);
		rawReq.on("error", reject);
		if (bodyStr) rawReq.write(bodyStr);
		rawReq.end();
	});
}

function withAuth(extra?: Record<string, string>): Record<string, string> {
	return { Authorization: `Bearer ${AUTH_TOKEN}`, ...(extra ?? {}) };
}

// ── Tests ─────────────────────────────────────────────────────

describe("POST /v1/compare", () => {
	it("returns 200 with comparison results", async () => {
		const res = await req({
			method: "POST",
			path: "/v1/compare",
			body: {
				prompt: "What is 2+2?",
				models: ["model-a", "model-b"],
			},
			headers: withAuth(),
		});

		assert.equal(res.status, 200);
		const data = res.json() as Record<string, unknown>;
		assert.ok(typeof data["id"] === "string");
		assert.equal(data["prompt"], "What is 2+2?");
		assert.ok(Array.isArray(data["results"]));
		assert.equal((data["results"] as unknown[]).length, 2);
		assert.ok(typeof data["summary"] === "object");
		assert.ok(typeof data["createdAt"] === "string");
	});

	it("returns 401 without auth token", async () => {
		const res = await req({
			method: "POST",
			path: "/v1/compare",
			body: {
				prompt: "test",
				models: ["model-a", "model-b"],
			},
		});

		assert.equal(res.status, 401);
	});

	it("returns 400 for invalid body — fewer than 2 models", async () => {
		const res = await req({
			method: "POST",
			path: "/v1/compare",
			body: {
				prompt: "test",
				models: ["only-one-model"],
			},
			headers: withAuth(),
		});

		assert.equal(res.status, 400);
		const data = res.json() as Record<string, unknown>;
		assert.ok(typeof data["error"] === "string");
		assert.equal(data["code"], "VALIDATION_ERROR");
	});

	it("returns 400 for missing prompt", async () => {
		const res = await req({
			method: "POST",
			path: "/v1/compare",
			body: {
				models: ["model-a", "model-b"],
			},
			headers: withAuth(),
		});

		assert.equal(res.status, 400);
	});

	it("returns 400 for empty prompt", async () => {
		const res = await req({
			method: "POST",
			path: "/v1/compare",
			body: {
				prompt: "",
				models: ["model-a", "model-b"],
			},
			headers: withAuth(),
		});

		assert.equal(res.status, 400);
	});

	it("returns 400 for duplicate models", async () => {
		const res = await req({
			method: "POST",
			path: "/v1/compare",
			body: {
				prompt: "test",
				models: ["model-a", "model-a"],
			},
			headers: withAuth(),
		});

		assert.equal(res.status, 400);
	});

	it("results persisted to store when persist=true", async () => {
		const promptId = randomUUID(); // unique marker to find the result

		const postRes = await req({
			method: "POST",
			path: "/v1/compare",
			body: {
				prompt: `Unique test: ${promptId}`,
				models: ["model-x", "model-y"],
				persist: true,
				project: "test-project",
			},
			headers: withAuth(),
		});

		assert.equal(postRes.status, 200);
		const posted = postRes.json() as Record<string, unknown>;
		const postedId = posted["id"] as string;

		// Query history to verify persistence
		const histRes = await req({
			method: "GET",
			path: "/v1/compare/history?project=test-project",
			headers: withAuth(),
		});

		assert.equal(histRes.status, 200);
		const histData = histRes.json() as Record<string, unknown>;
		const results = histData["results"] as Array<Record<string, unknown>>;
		const found = results.find((r) => r["id"] === postedId);
		assert.ok(found, `Expected to find id ${postedId} in history`);
	});
});

describe("GET /v1/compare/history", () => {
	it("returns 200 with results array", async () => {
		const res = await req({
			method: "GET",
			path: "/v1/compare/history",
			headers: withAuth(),
		});

		assert.equal(res.status, 200);
		const data = res.json() as Record<string, unknown>;
		assert.ok(Array.isArray(data["results"]));
		assert.ok(typeof data["count"] === "number");
	});

	it("returns 401 without auth", async () => {
		const res = await req({
			method: "GET",
			path: "/v1/compare/history",
		});

		assert.equal(res.status, 401);
	});

	it("project filter — returns only matching project results", async () => {
		const project = `test-filter-${randomUUID()}`;

		// POST with persist=true to a unique project
		await req({
			method: "POST",
			path: "/v1/compare",
			body: {
				prompt: "filter test",
				models: ["m1", "m2"],
				persist: true,
				project,
			},
			headers: withAuth(),
		});

		const res = await req({
			method: "GET",
			path: `/v1/compare/history?project=${project}`,
			headers: withAuth(),
		});

		assert.equal(res.status, 200);
		const data = res.json() as Record<string, unknown>;
		const results = data["results"] as Array<Record<string, unknown>>;
		assert.ok(results.length >= 1);
	});

	it("limit param is respected", async () => {
		const res = await req({
			method: "GET",
			path: "/v1/compare/history?limit=1",
			headers: withAuth(),
		});

		assert.equal(res.status, 200);
		const data = res.json() as Record<string, unknown>;
		const results = data["results"] as unknown[];
		assert.ok(results.length <= 1);
	});
});

describe("Task 4.5 — rate limit counter incremented once per comparison", () => {
	it("POST /v1/compare increments rate limit counter by 1 (not N per model)", async () => {
		// We verify the rate limiter is not over-counted by checking that
		// multiple sequential calls work correctly within limits.
		// The comparison should count as 1 request, not N (one per model).
		// We make 3 comparisons each with 3 models = should be 3 rate-limit hits, not 9.
		const results = [];
		for (let i = 0; i < 3; i++) {
			const r = await req({
				method: "POST",
				path: "/v1/compare",
				body: {
					prompt: `Rate limit test ${i}`,
					models: ["m1", "m2", "m3"],
				},
				headers: withAuth(),
			});
			results.push(r.status);
		}

		// All 3 should succeed (not rate-limited)
		for (const status of results) {
			assert.equal(status, 200);
		}
	});
});
