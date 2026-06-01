import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	executeNonStreamingChatCompletions,
	prepareChatCompletionsRequest,
} from "../src/server/execution/chat-completions-service.js";

describe("chat-completions-service", () => {
	it("prepares an optimized canonical request for the streaming handoff", () => {
		const prepared = prepareChatCompletionsRequest({
			messages: [
				{
					role: "user",
					content: "You are a helpful assistant.\n\nTask: Explain strict mode.",
				},
			],
		});

		assert.deepEqual(prepared.canonicalRequest.messages, [
			{
				role: "user",
				content: "You are a helpful assistant.\n\nTask: Explain strict mode.",
			},
		]);
		assert.deepEqual(prepared.optimizedCanonicalRequest.messages, [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "[Instruction]\nTask: Explain strict mode." },
		]);
	});

	it("executes the non-stream path with the prepared optimized messages and preserves response shape", async () => {
		const prepared = prepareChatCompletionsRequest({
			model: "gpt-4o-mini",
			max_tokens: 42,
			messages: [
				{ role: "system", content: "Be terse." },
				{ role: "assistant", content: "What do you need?" },
				{ role: "user", content: "Explain strict mode" },
			],
		});
		const captured: Array<Record<string, unknown>> = [];
		const logCtx = { provider: "unknown", model: "", startTime: 0 };

		const response = await executeNonStreamingChatCompletions({
			prepared,
			project: "project-alpha",
			now: () => 1_700_000_000_000,
			createChatCompletionId: () => "chatcmpl-test",
			requestLogger: {
				captureStart: (input: {
					provider: string;
					model: string;
					startTime: number;
				}) => {
					captured.push({ phase: "start", ...input });
					logCtx.model = input.model;
					logCtx.provider = input.provider;
					logCtx.startTime = input.startTime;
					return logCtx as never;
				},
				captureEnd: async (
					_ctx: unknown,
				input?: {
					provider?: string;
					model?: string;
					outputTokens?: number;
					responseData?: string;
					error?: Error;
					},
				) => {
					captured.push({ phase: "end", ...input });
				},
			} as never,
			router: {
				generate: async (request: unknown) => {
					captured.push({ phase: "generate", request: request as Record<string, unknown> });
					return {
						text: "Strict mode catches more bugs.",
						provider: "mock-provider",
						model: "gpt-4o-mini",
						tokensUsed: 9,
						requestedProvider: "openai",
						requestedModel: "gpt-4o-mini",
						resolvedProvider: "mock-provider",
						resolvedModel: "gpt-4o-mini",
						fallbackUsed: false,
						routing: { strategy: "mock", attemptedProviders: ["mock-provider"] },
					};
				},
			} as never,
		});

		assert.deepEqual(captured, [
			{
				phase: "start",
				provider: "unknown",
				model: "gpt-4o-mini",
				startTime: 1_700_000_000_000,
			},
			{
				phase: "generate",
				request: {
					prompt: "assistant: What do you need?\nuser: Explain strict mode",
					system: "Be terse.",
					model: "gpt-4o-mini",
					maxTokens: 42,
					project: "project-alpha",
				},
			},
			{
				phase: "end",
				provider: "mock-provider",
				model: "gpt-4o-mini",
				outputTokens: 9,
				responseData: JSON.stringify({
					text: "Strict mode catches more bugs.",
					provider: "mock-provider",
					model: "gpt-4o-mini",
					tokensUsed: 9,
					requestedProvider: "openai",
					requestedModel: "gpt-4o-mini",
					resolvedProvider: "mock-provider",
					resolvedModel: "gpt-4o-mini",
					fallbackUsed: false,
					routing: { strategy: "mock", attemptedProviders: ["mock-provider"] },
				}),
			},
		]);

		assert.deepEqual(response, {
			id: "chatcmpl-test",
			model: "gpt-4o-mini",
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: "Strict mode catches more bugs.",
					},
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 0,
				completion_tokens: 9,
				total_tokens: 9,
			},
			object: "chat.completion",
			created: 1_700_000_000,
			x_gateway: {
				requestedProvider: "openai",
				requestedModel: "gpt-4o-mini",
				resolvedProvider: "mock-provider",
				resolvedModel: "gpt-4o-mini",
				fallbackUsed: false,
				tokensUsed: 9,
				routing: { strategy: "mock", attemptedProviders: ["mock-provider"] },
			},
		});
	});
});
