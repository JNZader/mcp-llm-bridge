import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ChatCompletionsRequest } from "../src/core/schemas.js";
import {
	CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED,
	buildChatInternalRequestFromMessages,
	prepareChatGenerateRequest,
} from "../src/server/http-helpers/chat-request.js";

function createScope(project?: string) {
	return { project } satisfies Parameters<typeof prepareChatGenerateRequest>[1];
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
			prepareChatGenerateRequest(validated, createScope("project-alpha")),
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

		const prepared = prepareChatGenerateRequest(validated, createScope());

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
					createScope(),
				),
				new Error(CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED),
		);
	});

	it("builds an internal request with routing metadata from optimized chat messages", () => {
		assert.deepEqual(
			buildChatInternalRequestFromMessages(
				{
					model: "gpt-4o",
					max_tokens: 99,
					provider: "openai",
					strict: true,
					clientId: "client-123",
					messages: [{ role: "user", content: "ignored by helper" }],
				},
				[
					{ role: "system", content: "Be concise" },
					{ role: "user", content: "Explain strict mode" },
				],
				{ project: "project-alpha" },
			),
			{
				messages: [
					{ role: "system", content: "Be concise" },
					{ role: "user", content: "Explain strict mode" },
				],
				model: "gpt-4o",
				maxTokens: 99,
				metadata: {
					provider: "openai",
					clientId: "client-123",
					strict: true,
					project: "project-alpha",
				},
			},
		);
	});
});
