/**
 * Tests for the single-tenant bearerAuth middleware accepting `x-api-key`
 * as an alternate header to `Authorization: Bearer` (3b-1: Claude Code CLI
 * sends `x-api-key` by default for Anthropic-shaped clients).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";

import { bearerAuth } from "../../src/server/http-app.js";
import type { GatewayConfig } from "../../src/core/types.js";

function buildApp(config: GatewayConfig) {
	const app = new Hono();
	app.use("*", bearerAuth(config));
	app.get("/protected", (c) => c.json({ ok: true }));
	return app;
}

describe("bearerAuth — x-api-key support", () => {
	const config = { authToken: "bridge-token-123" } as GatewayConfig;

	it("accepts a valid Authorization: Bearer token (existing behavior preserved)", async () => {
		const app = buildApp(config);

		const res = await app.request("/protected", {
			headers: { Authorization: "Bearer bridge-token-123" },
		});

		assert.equal(res.status, 200);
	});

	it("accepts a valid x-api-key header carrying the same bridge token", async () => {
		const app = buildApp(config);

		const res = await app.request("/protected", {
			headers: { "x-api-key": "bridge-token-123" },
		});

		assert.equal(res.status, 200);
	});

	it("rejects an incorrect x-api-key token", async () => {
		const app = buildApp(config);

		const res = await app.request("/protected", {
			headers: { "x-api-key": "wrong-token" },
		});

		assert.equal(res.status, 401);
	});

	it("rejects a request with neither Authorization nor x-api-key", async () => {
		const app = buildApp(config);

		const res = await app.request("/protected");

		assert.equal(res.status, 401);
	});

	it("Authorization takes precedence when both headers are present and Authorization is invalid", async () => {
		const app = buildApp(config);

		const res = await app.request("/protected", {
			headers: {
				Authorization: "Bearer wrong-token",
				"x-api-key": "bridge-token-123",
			},
		});

		// Authorization header is checked first; an invalid Bearer token fails
		// the request even though x-api-key would have been valid on its own.
		assert.equal(res.status, 401);
	});

	it("still rejects a malformed Authorization header (no Bearer prefix)", async () => {
		const app = buildApp(config);

		const res = await app.request("/protected", {
			headers: { Authorization: "bridge-token-123" },
		});

		assert.equal(res.status, 401);
	});
});
