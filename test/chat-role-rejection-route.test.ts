import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";

import { registerExecutionRoutes } from "../src/server/routes/execution.js";

interface DispatchCounters {
	generate: number;
	generateFromInternal: number;
	resolveStreamingProviders: number;
}

function buildApp(counters: DispatchCounters): Hono {
	const app = new Hono();
	registerExecutionRoutes(app, {
		router: {
			generate: async () => {
				counters.generate += 1;
				throw new Error("generate should not be called for rejected chat roles");
			},
			generateFromInternal: async () => {
				counters.generateFromInternal += 1;
				throw new Error("generateFromInternal should not be called for rejected chat roles");
			},
			resolveStreamingProviders: async () => {
				counters.resolveStreamingProviders += 1;
				throw new Error("resolveStreamingProviders should not be called for rejected chat roles");
			},
		} as never,
		vault: {} as never,
	});
	return app;
}

describe("POST /v1/chat/completions unsupported roles", () => {
	it("returns a bounded invalid-request error before dispatch for mixed and unsupported-only requests", async () => {
		const unsupportedRoles = ["developer", "tool", "function"] as const;
		const streamModes = [false, true] as const;
		const requestShapes = ["mixed", "unsupported-only"] as const;
		const sentinelContent = "content-sentinel-must-not-appear";
		const sentinelToolMetadata = "tool-metadata-sentinel-must-not-appear";

		for (const role of unsupportedRoles) {
			for (const stream of streamModes) {
				for (const requestShape of requestShapes) {
					const counters: DispatchCounters = {
						generate: 0,
						generateFromInternal: 0,
						resolveStreamingProviders: 0,
					};
					const app = buildApp(counters);
					const unsupportedMessage = {
						role,
						content: sentinelContent,
						name: sentinelToolMetadata,
						tool_call_id: sentinelToolMetadata,
					};
					const messages =
						requestShape === "mixed"
							? [{ role: "user", content: "User." }, unsupportedMessage]
							: [unsupportedMessage];

					const response = await app.request("/v1/chat/completions", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ stream, messages }),
					});

					assert.equal(response.status, 400, `${role}/${stream}/${requestShape}`);
					assert.doesNotMatch(
						response.headers.get("content-type") ?? "",
						/text\/event-stream/,
					);
					const body = (await response.json()) as {
						error: { type: string; message: string };
					};
					assert.equal(body.error.type, "invalid_request_error");
					assert.equal(
						body.error.message,
						"Chat completions supports only system, user, and assistant message roles",
					);
					assert.equal(body.error.message.includes(sentinelContent), false);
					assert.equal(body.error.message.includes(sentinelToolMetadata), false);
					assert.deepEqual(counters, {
						generate: 0,
						generateFromInternal: 0,
						resolveStreamingProviders: 0,
					});
				}
			}
		}
	});
});
