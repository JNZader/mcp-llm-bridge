import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";

import { handleUsageTool } from "../../../src/server/mcp-tool-handlers.js";
import { TOOLS } from "../../../src/server/mcp-tool-registry.js";
import { registerUsageRoutes } from "../../../src/server/routes/usage.js";

const PROVIDER_CANARY = "provider failure: usage-readback-canary";

const tracker = {
	query: () => [{
		id: 42, provider: "openai", keyName: "secret-key", model: "gpt-4o", project: "private-project",
		userId: "private-user", tokensIn: 3, tokensOut: 5, totalTokens: 8, costUsd: 0.01,
		latencyMs: 7, success: false, errorMessage: PROVIDER_CANARY, createdAt: "2026-09-12T00:00:00.000Z",
	}],
	summary: () => ({
		totalRequests: 1, totalTokensIn: 3, totalTokensOut: 5, totalTokens: 8, totalCostUsd: 0.01,
		knownCostUsd: 0.01, unknownCostRequestCount: 0, hasUnknownCost: false, avgLatencyMs: 7, breakdown: [],
	}),
};

function app() {
	const instance = new Hono();
	registerUsageRoutes(instance, {
		costTracker: tracker as never,
		authorizeReadback: (scope) => scope === "workspace-a",
	});
	return instance;
}

describe("protected usage readback", () => {
	it("fails closed with the same normalized error for known and unknown identifiers", async () => {
		const instance = app();
		const known = await instance.request("/v2/usage?id=42");
		const unknown = await instance.request("/v2/usage?id=does-not-exist");

		assert.equal(known.status, 403);
		assert.deepEqual(await known.json(), { error: "Access is denied.", code: "ACCESS_DENIED" });
		assert.deepEqual(await unknown.json(), { error: "Access is denied.", code: "ACCESS_DENIED" });
	});

	it("returns only the safe v2 projection and explicitly deprecates v1", async () => {
		const instance = app();
		const v1 = await instance.request("/v1/usage", { headers: { "X-Telemetry-Scope": "workspace-a" } });
		const v2 = await instance.request("/v2/usage", { headers: { "X-Telemetry-Scope": "workspace-a" } });
		const body = await v2.json() as { records: Array<Record<string, unknown>> };
		const record = body.records[0]!;

		assert.equal(v1.headers.get("deprecation"), "true");
		assert.equal(v1.headers.get("link"), '</v2/usage>; rel="successor-version"');
		assert.equal(v2.headers.get("deprecation"), null);
		assert.equal(record.id, "usage_42");
		assert.equal(record.errorMessage, "Provider request failed");
		assert.equal(record.errorCode, "failed");
		assert.equal(record.errorCategory, "client");
		for (const forbidden of ["keyName", "project", "userId", PROVIDER_CANARY]) {
			assert.equal(JSON.stringify(body).includes(forbidden), false);
		}
	});

	it("requires MCP scope and declares the old schemas deprecated", () => {
		const denied = handleUsageTool("usage_query", { id: "legacy-or-unknown" }, tracker as never);
		assert.deepEqual(JSON.parse(denied!.content[0]!.text), { error: "Access is denied.", code: "ACCESS_DENIED" });

		const allowed = handleUsageTool(
			"usage_query",
			{ scope: "workspace-a" },
			tracker as never,
			(scope) => scope === "workspace-a",
		);
		assert.equal(JSON.stringify(allowed).includes(PROVIDER_CANARY), false);
		for (const name of ["usage_summary", "usage_query"]) {
			const tool = TOOLS.find((entry) => entry.name === name) as import("../../../src/server/mcp-tool-registry.js").McpToolDefinition | undefined;
			if (!tool) throw new Error(`Missing MCP tool ${name}`);
			assert.equal(tool.deprecation?.deprecated, true);
			assert.equal(tool.inputSchema["deprecated"], true);
		}
	});

	it("denies a project that is outside the granted telemetry scope", async () => {
		const response = await app().request("/v2/usage?project=workspace-b", {
			headers: { "X-Telemetry-Scope": "workspace-a" },
		});

		assert.equal(response.status, 403);
		assert.deepEqual(await response.json(), { error: "Access is denied.", code: "ACCESS_DENIED" });
	});

	it("normalizes indeterminate scope evaluation as access denied", async () => {
		const instance = new Hono();
		registerUsageRoutes(instance, {
			costTracker: tracker as never,
			authorizeReadback: () => { throw new Error("authorization backend unavailable"); },
		});

		const response = await instance.request("/v2/usage", { headers: { "X-Telemetry-Scope": "workspace-a" } });
		assert.equal(response.status, 403);
		assert.deepEqual(await response.json(), { error: "Access is denied.", code: "ACCESS_DENIED" });
	});
});
