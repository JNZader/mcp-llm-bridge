import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serializeLogPayload } from "../../src/logging/serialize-log-payload.js";

describe("serializeLogPayload", () => {
	it("bounds strings before returning them", () => {
		assert.equal(serializeLogPayload("x".repeat(20), 10), "x".repeat(10));
	});

	it("bounds string values while serializing objects", () => {
		const serialized = serializeLogPayload({ text: "x".repeat(20) }, 10);

		assert.ok(serialized);
		assert.ok(serialized.length <= 10);
	});

	it("returns undefined when data cannot be serialized", () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;

		assert.equal(serializeLogPayload(circular), undefined);
	});
});
