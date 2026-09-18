import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_CHAT_MESSAGES, MAX_PROMPT_LENGTH } from "../src/core/constants.js";
import {
	chatCompletionsSchema,
	generateRequestSchema,
} from "../src/core/schemas.js";

describe("request field limits", () => {
	it("rejects generate context over MAX_PROMPT_LENGTH", () => {
		const result = generateRequestSchema.safeParse({
			context: "x".repeat(MAX_PROMPT_LENGTH + 1),
		});
		assert.equal(result.success, false);
	});

	it("rejects too many chat messages", () => {
		const result = chatCompletionsSchema.safeParse({
			messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => ({
				role: "user",
				content: "hi",
			})),
		});
		assert.equal(result.success, false);
	});

	it("rejects oversized string message content", () => {
		const result = chatCompletionsSchema.safeParse({
			messages: [{ role: "user", content: "x".repeat(MAX_PROMPT_LENGTH + 1) }],
		});
		assert.equal(result.success, false);
	});
});
