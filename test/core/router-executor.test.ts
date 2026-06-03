import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tryProvider } from "../../src/core/router-executor.js";

describe("router-executor tryProvider", () => {
	it("keeps usage unknown when legacy provider.generate omits tokensUsed", async () => {
		const usageRecords: Array<Record<string, unknown>> = [];

		const response = await tryProvider({
			provider: {
				id: "legacy-cli",
				name: "legacy-cli",
				type: "api",
				models: [],
				async generate() {
					return {
						text: "done",
						provider: "legacy-cli",
						model: "legacy-model",
						resolvedProvider: "legacy-cli",
						resolvedModel: "legacy-model",
						fallbackUsed: false,
					};
				},
				async isAvailable() {
					return true;
				},
			},
			request: {
				messages: [{ role: "user", content: "hello" }],
				model: "legacy-model",
			},
			registry: {
				getOutbound: (providerId: string) =>
					providerId === "legacy-cli"
						? { transformRequest: () => ({ transformed: true }) }
						: undefined,
			} as never,
			circuitBreaker: {
				recordSuccess: () => {},
				recordFailure: () => {},
			} as never,
			attempt: 1,
			resolveFeedbackEndpointId: () => "legacy-cli",
			recordUsage: (_provider, _model, usage) => {
				usageRecords.push(usage as Record<string, unknown>);
			},
			recordModelFeedback: () => {},
		});

		assert.equal(response.content, "done");
		assert.deepEqual(response.usage, {});
		assert.deepEqual(usageRecords, [{}]);
	});
});
