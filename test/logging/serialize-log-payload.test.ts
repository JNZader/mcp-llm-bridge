import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serializeLogPayload } from "../../src/logging/serialize-log-payload.js";

describe("serializeLogPayload", () => {
	it("does not persist raw prompt or response strings", () => {
		assert.equal(serializeLogPayload("secret prompt"), undefined);
		assert.equal(serializeLogPayload("x".repeat(20), 10), undefined);
	});

	it("drops text/prompt fields and keeps routing metadata", () => {
		const serialized = serializeLogPayload({
			text: "model output that must not land in sqlite",
			prompt: "user secret",
			provider: "opencode-cli",
			model: "opencode/big-pickle",
			tokensUsed: 12,
			fallbackUsed: false,
		});

		assert.ok(serialized);
		assert.doesNotMatch(serialized, /model output|user secret|big-pickle secret/i);
		assert.match(serialized, /opencode-cli/);
		assert.match(serialized, /tokensUsed/);
	});

	it("redacts credential-like leftovers in remaining metadata", () => {
		const serialized = serializeLogPayload({
			provider: "openai",
			note: "Bearer sk-live-secret",
		});

		assert.ok(serialized);
		assert.doesNotMatch(serialized, /sk-live-secret/);
		assert.match(serialized, /Bearer \[REDACTED\]/);
	});

	it("returns undefined when data cannot be serialized", () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;

		assert.equal(serializeLogPayload(circular), undefined);
	});
});
