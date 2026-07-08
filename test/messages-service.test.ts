import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	buildAnthropicMessageResponse,
	executeNonStreamingMessages,
	mapFinishReasonToStopReason,
	prepareMessagesRequest,
} from "../src/server/execution/messages-service.js";
import { TransformError } from "../src/core/transformer.js";
import type { InternalLLMResponse } from "../src/core/internal-model.js";

describe("messages-service", () => {
	describe("prepareMessagesRequest", () => {
		it("parses an Anthropic-shaped body into an InternalLLMRequest", () => {
			const prepared = prepareMessagesRequest({
				model: "claude-opus-4",
				max_tokens: 1024,
				system: "Be terse.",
				messages: [{ role: "user", content: "Explain strict mode" }],
			});

			assert.equal(prepared.model, "claude-opus-4");
			assert.deepEqual(prepared.internalRequest.messages, [
				{ role: "system", content: "Be terse." },
				{ role: "user", content: "Explain strict mode" },
			]);
			assert.equal(prepared.internalRequest.maxTokens, 1024);
		});

		it("layers scope (project/apiKeyId/userId) into request metadata", () => {
			const prepared = prepareMessagesRequest(
				{
					max_tokens: 10,
					messages: [{ role: "user", content: "hi" }],
				},
				{ project: "project-alpha", apiKeyId: "key-123", userId: "user-456" },
			);

			assert.deepEqual(prepared.internalRequest.metadata, {
				project: "project-alpha",
				apiKeyId: "key-123",
				userId: "user-456",
			});
		});

		it("propagates TransformError from the anthropic inbound transformer on malformed input", () => {
			assert.throws(
				() => prepareMessagesRequest({ max_tokens: 10, messages: [] }),
				(error: unknown) => {
					assert.ok(error instanceof TransformError);
					assert.match(error.message, /non-empty array/);
					return true;
				},
			);
		});
	});

	describe("mapFinishReasonToStopReason", () => {
		it("maps every internal finishReason to the correct Anthropic stop_reason", () => {
			assert.equal(mapFinishReasonToStopReason("stop"), "end_turn");
			assert.equal(mapFinishReasonToStopReason("length"), "max_tokens");
			assert.equal(mapFinishReasonToStopReason("tool_calls"), "tool_use");
			assert.equal(mapFinishReasonToStopReason("content_filter"), "end_turn");
			assert.equal(mapFinishReasonToStopReason("error"), "end_turn");
		});

		it("falls back to end_turn for an unrecognized finishReason", () => {
			assert.equal(mapFinishReasonToStopReason("something_unknown"), "end_turn");
		});
	});

	describe("buildAnthropicMessageResponse", () => {
		function baseResult(overrides: Partial<InternalLLMResponse> = {}): InternalLLMResponse {
			return {
				content: "Strict mode catches more bugs.",
				model: "claude-opus-4",
				usage: {},
				finishReason: "stop",
				...overrides,
			};
		}

		it("builds the exact Anthropic Messages response shape", () => {
			const response = buildAnthropicMessageResponse({
				result: baseResult({ usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } }),
				messageId: "msg_test123",
			});

			assert.deepEqual(response, {
				id: "msg_test123",
				type: "message",
				role: "assistant",
				model: "claude-opus-4",
				content: [{ type: "text", text: "Strict mode catches more bugs." }],
				stop_reason: "end_turn",
				stop_sequence: null,
				usage: { input_tokens: 12, output_tokens: 8 },
			});
		});

		it("coerces unknown internal usage to 0/0 numbers in the HTTP response (Anthropic requires numbers)", () => {
			const response = buildAnthropicMessageResponse({
				result: baseResult({ usage: {} }),
			});

			assert.deepEqual(response.usage, { input_tokens: 0, output_tokens: 0 });
			assert.equal(typeof response.usage.input_tokens, "number");
			assert.equal(typeof response.usage.output_tokens, "number");
		});

		it("maps tool_calls finishReason to tool_use stop_reason", () => {
			const response = buildAnthropicMessageResponse({
				result: baseResult({ finishReason: "tool_calls" }),
			});

			assert.equal(response.stop_reason, "tool_use");
		});

		it("generates a msg_-prefixed id when none is provided", () => {
			const response = buildAnthropicMessageResponse({ result: baseResult() });

			assert.match(response.id, /^msg_/);
		});
	});

	describe("executeNonStreamingMessages", () => {
		it("dispatches the prepared internal request through the router and returns an Anthropic response", async () => {
			const prepared = prepareMessagesRequest({
				model: "claude-opus-4",
				max_tokens: 100,
				messages: [{ role: "user", content: "Explain strict mode" }],
			});

			const captured: Array<Record<string, unknown>> = [];

			const response = await executeNonStreamingMessages({
				prepared,
				createMessageId: () => "msg_fixed",
				router: {
					generateFromInternal: async (request: unknown) => {
						captured.push({ request: request as Record<string, unknown> });
						return {
							content: "Strict mode catches more bugs.",
							model: "claude-opus-4",
							usage: { inputTokens: 5, outputTokens: 9, totalTokens: 14 },
							finishReason: "stop",
						} satisfies InternalLLMResponse;
					},
				} as never,
			});

			assert.equal(captured.length, 1);
			assert.deepEqual(response, {
				id: "msg_fixed",
				type: "message",
				role: "assistant",
				model: "claude-opus-4",
				content: [{ type: "text", text: "Strict mode catches more bugs." }],
				stop_reason: "end_turn",
				stop_sequence: null,
				usage: { input_tokens: 5, output_tokens: 9 },
			});
		});

		it("logs start/end via requestLogger on success", async () => {
			const prepared = prepareMessagesRequest({
				max_tokens: 10,
				messages: [{ role: "user", content: "hi" }],
			});

			const captured: Array<Record<string, unknown>> = [];
			const logCtx = { provider: "unknown", model: "", startTime: 0 };

			await executeNonStreamingMessages({
				prepared,
				now: () => 1_700_000_000_000,
				router: {
					generateFromInternal: async () => ({
						content: "hello",
						model: "claude-opus-4",
						usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
						finishReason: "stop",
					}) satisfies InternalLLMResponse,
				} as never,
				requestLogger: {
					captureStart: (input: { provider: string; model: string; startTime: number }) => {
						captured.push({ phase: "start", ...input });
						logCtx.model = input.model;
						logCtx.provider = input.provider;
						logCtx.startTime = input.startTime;
						return logCtx as never;
					},
					captureEnd: async (
						_ctx: unknown,
						input?: {
							totalTokens?: number;
							inputTokens?: number;
							outputTokens?: number;
							attempts?: number;
						},
					) => {
						captured.push({ phase: "end", ...input });
					},
				} as never,
			});

			assert.equal(captured[0]?.["phase"], "start");
			assert.equal(captured[1]?.["phase"], "end");
			assert.equal(captured[1]?.["inputTokens"], 1);
			assert.equal(captured[1]?.["outputTokens"], 1);
		});

		it("propagates router errors without swallowing them", async () => {
			const prepared = prepareMessagesRequest({
				max_tokens: 10,
				messages: [{ role: "user", content: "hi" }],
			});

			await assert.rejects(
				() =>
					executeNonStreamingMessages({
						prepared,
						router: {
							generateFromInternal: async () => {
								throw new Error("all providers failed");
							},
						} as never,
					}),
				/all providers failed/,
			);
		});
	});
});
