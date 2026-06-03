import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	executeNonStreamingChatCompletions,
	prepareChatCompletionsRequest,
} from "../src/server/execution/chat-completions-service.js";
import { validateChatCompletions } from "../src/core/schemas.js";

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

	it("preserves provider, strict, clientId, and project through validation and preparation", () => {
		const prepared = prepareChatCompletionsRequest(
			validateChatCompletions({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "Explain strict mode" }],
				provider: "openai",
				strict: true,
				clientId: "client-123",
				project: "project-alpha",
			}),
		);

		assert.equal(prepared.canonicalRequest.provider, "openai");
		assert.equal(prepared.canonicalRequest.strict, true);
		assert.equal(prepared.canonicalRequest.clientId, "client-123");
		assert.equal(prepared.canonicalRequest.project, "project-alpha");
		assert.equal(prepared.optimizedCanonicalRequest.provider, "openai");
		assert.equal(prepared.optimizedCanonicalRequest.strict, true);
		assert.equal(prepared.optimizedCanonicalRequest.clientId, "client-123");
		assert.equal(prepared.optimizedCanonicalRequest.project, "project-alpha");
	});

	it("rejects assistant-only requests before stream/non-stream branching", () => {
		assert.throws(
			() =>
				prepareChatCompletionsRequest({
					messages: [{ role: "assistant", content: "Hello" }],
				}),
			new Error("At least one user message is required"),
		);
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
			scope: { project: "project-alpha" },
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
						totalTokens?: number;
						inputTokens?: number;
						outputTokens?: number;
						attempts?: number;
						responseData?: string;
						error?: Error;
					},
				) => {
					captured.push({ phase: "end", ...input });
				},
			} as never,
			router: {
				generateFromInternal: async (request: unknown) => {
					captured.push({ phase: "generate", request: request as Record<string, unknown> });
					return {
						content: "Strict mode catches more bugs.",
						model: "gpt-4o-mini",
						finishReason: "stop",
						usage: {
							inputTokens: 4,
							outputTokens: 5,
							totalTokens: 9,
						},
						metadata: {
							provider: "mock-provider",
							requestedProvider: "openai",
							requestedModel: "gpt-4o-mini",
							resolvedProvider: "mock-provider",
							resolvedModel: "gpt-4o-mini",
							fallbackUsed: false,
							routing: { strategy: "mock", attemptedProviders: ["mock-provider"] },
						},
					};
				},
			} as never,
		});

		assert.deepEqual(captured, [
			{
				phase: "start",
				provider: "unknown",
				model: "gpt-4o-mini",
				correlationId: undefined,
				startTime: 1_700_000_000_000,
			},
			{
				phase: "generate",
				request: {
					messages: [
						{ role: "system", content: "Be terse." },
						{ role: "assistant", content: "What do you need?" },
						{ role: "user", content: "Explain strict mode" },
					],
					model: "gpt-4o-mini",
					maxTokens: 42,
					metadata: {
						project: "project-alpha",
					},
				},
			},
			{
				phase: "end",
				provider: "mock-provider",
				model: "gpt-4o-mini",
				totalTokens: 9,
				inputTokens: 4,
				outputTokens: 5,
				attempts: 1,
				responseData: JSON.stringify({
					text: "Strict mode catches more bugs.",
					provider: "mock-provider",
					model: "gpt-4o-mini",
					tokensUsed: 9,
					inputTokens: 4,
					outputTokens: 5,
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
				prompt_tokens: 4,
				completion_tokens: 5,
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
				inputTokens: 4,
				outputTokens: 5,
				routing: { strategy: "mock", attemptedProviders: ["mock-provider"] },
			},
		});
	});

	it("logs attempted provider count for non-stream chat retries", async () => {
		const prepared = prepareChatCompletionsRequest({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: "Explain strict mode" }],
		});
		const captured: Array<Record<string, unknown>> = [];

		await executeNonStreamingChatCompletions({
			prepared,
			scope: {},
			requestLogger: {
				captureStart: () => ({ provider: "unknown", model: "gpt-4o-mini", startTime: 0 }) as never,
				captureEnd: async (_ctx: unknown, input?: { attempts?: number }) => {
					captured.push({ phase: "end", attempts: input?.attempts });
				},
			} as never,
			router: {
				generateFromInternal: async () => ({
					content: "done",
					model: "gpt-4o-mini",
					finishReason: "stop",
					usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
					metadata: {
						provider: "mock-provider",
						resolvedProvider: "mock-provider",
						resolvedModel: "gpt-4o-mini",
						fallbackUsed: true,
						routing: {
							strategy: "mock",
							attemptedProviders: ["first-provider", "second-provider", "mock-provider"],
						},
					},
				}),
			} as never,
		});

		assert.deepEqual(captured, [{ phase: "end", attempts: 3 }]);
	});
});
