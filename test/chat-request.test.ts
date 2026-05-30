import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ChatCompletionsRequest } from "../src/core/schemas.js";
import {
	CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED,
	prepareChatGenerateRequest,
} from "../src/server/http-helpers/chat-request.js";

function createContext(headerProject?: string) {
	return {
		req: {
			header(name: string) {
				return name === "X-Project" ? headerProject : undefined;
			},
		},
	} as Parameters<typeof prepareChatGenerateRequest>[1];
}

describe("prepareChatGenerateRequest", () => {
	it("derives the router payload for a non-streaming chat request", () => {
		const validated: ChatCompletionsRequest = {
			model: "gpt-4o",
			max_tokens: 321,
			messages: [
				{ role: "system", content: "Be concise" },
				{ role: "assistant", content: "What do you need?" },
				{ role: "user", content: "Explain strict mode" },
			],
		};

		assert.deepEqual(
			prepareChatGenerateRequest(validated, createContext("project-alpha")),
			{
				prompt: "assistant: What do you need?\nuser: Explain strict mode",
				system: "Be concise",
				model: "gpt-4o",
				maxTokens: 321,
				project: "project-alpha",
			},
		);
	});

	it("preserves explicit system messages without re-optimizing them", () => {
		const validated: ChatCompletionsRequest = {
			messages: [
				{ role: "system", content: "Keep this system" },
				{ role: "user", content: "You are a helpful assistant.\n\nTask: Explain useMemo." },
			],
		};

		const prepared = prepareChatGenerateRequest(validated, createContext());

		assert.equal(prepared.system, "Keep this system");
		assert.equal(
			prepared.prompt,
			"You are a helpful assistant.\n\nTask: Explain useMemo.",
		);
	});

	it("throws when the conversation has no user message", () => {
		assert.throws(
			() =>
				prepareChatGenerateRequest(
					{ messages: [{ role: "assistant", content: "Hello" }] },
					createContext(),
				),
				new Error(CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED),
		);
	});
});
