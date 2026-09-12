import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";

import { registerObservabilityRoutes } from "../../../src/server/routes/observability.js";

const CANARY = "provider-log-canary";

function app() {
	const instance = new Hono();
	registerObservabilityRoutes(instance, {
		router: {} as never,
		authorizeReadback: (scope) => scope === "workspace-a",
		requestLogger: {
			getLogs: async () => ({
				logs: [{
					id: 7, timestamp: 1, provider: "openai", model: "gpt-4o", correlationId: "private-correlation",
					totalTokens: 8, inputTokens: 3, outputTokens: 5, cost: 0.01, latencyMs: 7,
					error: CANARY, attempts: 1,
				}],
				total: 1, limit: 100, offset: 0,
			}),
		} as never,
	});
	return instance;
}

describe("protected observability readback", () => {
	it("fails closed before checking log availability or record identity", async () => {
		const instance = app();
		const known = await instance.request("/v1/logs?id=7");
		const unknown = await instance.request("/v1/logs?id=unknown");

		assert.deepEqual(await known.json(), { error: "Access is denied.", code: "ACCESS_DENIED" });
		assert.deepEqual(await unknown.json(), { error: "Access is denied.", code: "ACCESS_DENIED" });
	});

	it("denies unauthenticated metrics readback before checking providers", async () => {
		const response = await app().request("/metrics");

		assert.equal(response.status, 403);
		assert.deepEqual(await response.json(), { error: "Access is denied.", code: "ACCESS_DENIED" });
	});

	it("projects logs without raw correlation IDs or provider failure text", async () => {
		const response = await app().request("/v1/logs", { headers: { "X-Telemetry-Scope": "workspace-a" } });
		const body = await response.json() as { logs: Array<Record<string, unknown>> };
		const log = body.logs[0]!;

		assert.equal(response.status, 200);
		assert.equal(log.id, "log_7");
		assert.equal(log.error, "Provider request failed");
		assert.equal("correlationId" in log, false);
		assert.equal(JSON.stringify(body).includes(CANARY), false);
	});

	it("exposes maintainer retention provenance and sink ownership only to authorized operators", async () => {
		const response = await app().request("/v1/retention", {
			headers: { "X-Telemetry-Scope": "workspace-a" },
		});
		const body = await response.json() as {
			retentionDays: number;
			decision: string;
			evidenceBasis: string;
			sinks: Array<{ sink: string; deletionOwner: string; verificationControl: string }>;
		};

		assert.equal(response.status, 200);
		assert.equal(body.retentionDays, 30);
		assert.match(body.decision, /Maintainer-selected/);
		assert.match(body.evidenceBasis, /not externally researched/i);
		assert.equal(body.sinks.length, 7);
		assert.ok(body.sinks.every((sink) => sink.deletionOwner && sink.verificationControl));
	});
});
