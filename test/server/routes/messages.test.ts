import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";

import { registerMessagesRoutes } from "../../../src/server/routes/messages.js";
import type { InternalLLMResponse } from "../../../src/core/internal-model.js";
import type { InternalLLMChunk } from "../../../src/transformers/streaming.js";

function buildApp(
	generateFromInternal: (request: unknown) => Promise<InternalLLMResponse>,
) {
	const app = new Hono();
	registerMessagesRoutes(app, {
		router: { generateFromInternal } as never,
		vault: {} as never,
	});
	return app;
}

// ── Streaming test helpers ───────────────────────────────────

/** A single parsed SSE event block: `event: <name>` + `data: <json>`. */
interface ParsedSSEEvent {
	event: string;
	data: Record<string, unknown>;
}

/**
 * Parse a raw SSE response body into a sequence of `{ event, data }` blocks,
 * exactly the way a real SSE client would: split on the blank-line terminator,
 * pull out the `event:` and `data:` lines, and JSON-parse the payload. Fails
 * loudly if any block is missing its `event:` line (which would hang a real
 * Anthropic SDK / Claude Code CLI client).
 */
function parseSSE(raw: string): ParsedSSEEvent[] {
	return raw
		.split("\n\n")
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) => {
			const lines = block.split("\n");
			const eventLine = lines.find((l) => l.startsWith("event:"));
			const dataLine = lines.find((l) => l.startsWith("data:"));
			assert.ok(eventLine, `SSE block missing "event:" line:\n${block}`);
			assert.ok(dataLine, `SSE block missing "data:" line:\n${block}`);
			return {
				event: eventLine.slice("event:".length).trim(),
				data: JSON.parse(dataLine.slice("data:".length).trim()) as Record<string, unknown>,
			};
		});
}

interface FakeStreamingCandidate {
	provider: { id: string; name: string; type: "api"; models: never[]; generate: () => Promise<never>; isAvailable: () => Promise<boolean> };
	request: { messages: never[]; model: string };
	streamTransformer: { name: string; transformStream: () => AsyncGenerator<InternalLLMChunk> };
	executionContract: { recordAttempt: () => void; snapshot: () => Record<string, unknown> };
	recordResult: (input: unknown) => void;
	onSuccess?: () => void;
}

/** Build a fake `ResolvedStreamingProvider`-shaped candidate for router mocks. */
function fakeStreamingCandidate(
	chunks: InternalLLMChunk[] | (() => AsyncGenerator<InternalLLMChunk>),
	opts?: { providerId?: string; model?: string },
): FakeStreamingCandidate {
	const providerId = opts?.providerId ?? "anthropic";
	const model = opts?.model ?? "claude-opus-4";

	async function* generate(): AsyncGenerator<InternalLLMChunk> {
		if (typeof chunks === "function") {
			yield* chunks();
		} else {
			for (const chunk of chunks) yield chunk;
		}
	}

	return {
		provider: {
			id: providerId,
			name: providerId,
			type: "api",
			models: [],
			generate: () => {
				throw new Error("streaming test should not call non-streaming generate()");
			},
			isAvailable: async () => true,
		},
		request: { messages: [], model },
		streamTransformer: { name: providerId, transformStream: generate },
		executionContract: { recordAttempt: () => {}, snapshot: () => ({}) },
		recordResult: () => {},
	};
}

function buildStreamingApp(input: {
	resolveStreamingProviders: () => Promise<FakeStreamingCandidate[]>;
	generateFromInternal?: (request: unknown) => Promise<InternalLLMResponse>;
}) {
	const app = new Hono();
	registerMessagesRoutes(app, {
		router: {
			resolveStreamingProviders: input.resolveStreamingProviders,
			generateFromInternal:
				input.generateFromInternal ??
				(async () => {
					throw new Error("non-streaming generateFromInternal should not be called");
				}),
		} as never,
		vault: {} as never,
	});
	return app;
}

async function requestStreamingMessages(app: Hono, body: Record<string, unknown>) {
	return app.request("/v1/messages", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "claude-opus-4",
			max_tokens: 100,
			stream: true,
			messages: [{ role: "user", content: "hi" }],
			...body,
		}),
	});
}

describe("POST /v1/messages", () => {
	it("returns an Anthropic Messages response for a non-streaming request", async () => {
		const app = buildApp(async () => ({
			content: "Strict mode catches more bugs.",
			model: "claude-opus-4",
			usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
			finishReason: "stop",
		}));

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "claude-opus-4",
				max_tokens: 100,
				messages: [{ role: "user", content: "Explain strict mode" }],
			}),
		});

		assert.equal(res.status, 200);
		const body = (await res.json()) as Record<string, unknown>;

		assert.match(body["id"] as string, /^msg_/);
		assert.equal(body["type"], "message");
		assert.equal(body["role"], "assistant");
		assert.equal(body["model"], "claude-opus-4");
		assert.deepEqual(body["content"], [
			{ type: "text", text: "Strict mode catches more bugs." },
		]);
		assert.equal(body["stop_reason"], "end_turn");
		assert.equal(body["stop_sequence"], null);
		assert.deepEqual(body["usage"], { input_tokens: 12, output_tokens: 8 });
	});

	it("maps every finishReason to its Anthropic stop_reason in the actual HTTP response", async () => {
		const cases: Array<[InternalLLMResponse["finishReason"], string]> = [
			["stop", "end_turn"],
			["length", "max_tokens"],
			["tool_calls", "tool_use"],
			["content_filter", "end_turn"],
			["error", "end_turn"],
		];

		for (const [finishReason, expectedStopReason] of cases) {
			const app = buildApp(async () => ({
				content: "x",
				model: "claude-opus-4",
				usage: {},
				finishReason,
			}));

			const res = await app.request("/v1/messages", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					max_tokens: 10,
					messages: [{ role: "user", content: "hi" }],
				}),
			});

			const body = (await res.json()) as { stop_reason: string };
			assert.equal(body.stop_reason, expectedStopReason, `finishReason=${finishReason}`);
		}
	});

	it("coerces unknown usage to 0/0 numbers in the wire response", async () => {
		const app = buildApp(async () => ({
			content: "x",
			model: "claude-opus-4",
			usage: {},
			finishReason: "stop",
		}));

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				max_tokens: 10,
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		const body = (await res.json()) as { usage: { input_tokens: number; output_tokens: number } };
		assert.equal(body.usage.input_tokens, 0);
		assert.equal(body.usage.output_tokens, 0);
		assert.equal(typeof body.usage.input_tokens, "number");
		assert.equal(typeof body.usage.output_tokens, "number");
	});

	it("returns a 400 Anthropic-shaped error for malformed input (empty messages)", async () => {
		const app = buildApp(async () => {
			throw new Error("should not be called");
		});

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ max_tokens: 10, messages: [] }),
		});

		assert.equal(res.status, 400);
		const body = (await res.json()) as { type: string; error: { type: string; message: string } };
		assert.equal(body.type, "error");
		assert.equal(body.error.type, "invalid_request_error");
		assert.match(body.error.message, /non-empty array/);
	});

	it("returns a 500 Anthropic-shaped error when the router fails", async () => {
		const app = buildApp(async () => {
			throw new Error("all providers failed");
		});

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				max_tokens: 10,
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		assert.equal(res.status, 500);
		const body = (await res.json()) as { type: string; error: { type: string; message: string } };
		assert.equal(body.type, "error");
		assert.equal(body.error.type, "api_error");
		assert.match(body.error.message, /all providers failed/);
	});
});

describe("POST /v1/messages (stream: true)", () => {
	it("streams the exact Anthropic SSE event sequence for a text response", async () => {
		const app = buildStreamingApp({
			resolveStreamingProviders: async () => [
				fakeStreamingCandidate([
					{ content: "Hello", done: false },
					{ content: " world", done: false },
					{
						content: "",
						done: true,
						model: "claude-opus-4",
						finishReason: "stop",
						tokensIn: 12,
						tokensOut: 8,
					},
				]),
			],
		});

		const res = await requestStreamingMessages(app, {});

		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

		const events = parseSSE(await res.text());

		assert.deepEqual(
			events.map((e) => e.event),
			[
				"message_start",
				"content_block_start",
				"ping",
				"content_block_delta",
				"content_block_delta",
				"content_block_stop",
				"message_delta",
				"message_stop",
			],
		);

		const [messageStart, blockStart, ping, delta1, delta2, blockStop, messageDelta, messageStop] =
			events;

		assert.equal(messageStart!.data["type"], "message_start");
		const message = messageStart!.data["message"] as Record<string, unknown>;
		assert.match(message["id"] as string, /^msg_/);
		assert.equal(message["type"], "message");
		assert.equal(message["role"], "assistant");
		assert.equal(message["model"], "claude-opus-4");
		assert.deepEqual(message["content"], []);
		assert.equal(message["stop_reason"], null);
		assert.equal(message["stop_sequence"], null);
		assert.deepEqual(message["usage"], { input_tokens: 0, output_tokens: 0 });

		assert.deepEqual(blockStart!.data, {
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		});

		assert.deepEqual(ping!.data, { type: "ping" });

		assert.deepEqual(delta1!.data, {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Hello" },
		});
		assert.deepEqual(delta2!.data, {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: " world" },
		});

		assert.deepEqual(blockStop!.data, { type: "content_block_stop", index: 0 });

		assert.deepEqual(messageDelta!.data, {
			type: "message_delta",
			delta: { stop_reason: "end_turn", stop_sequence: null },
			usage: { output_tokens: 8 },
		});

		assert.deepEqual(messageStop!.data, { type: "message_stop" });
	});

	it("streams a tool_use content block as a single non-incremental JSON delta", async () => {
		const app = buildStreamingApp({
			resolveStreamingProviders: async () => [
				fakeStreamingCandidate([
					{
						content: "",
						done: true,
						model: "claude-opus-4",
						finishReason: "tool_calls",
						tokensIn: 5,
						tokensOut: 10,
						toolCalls: [
							{
								id: "toolu_abc123",
								type: "function",
								function: { name: "get_weather", arguments: '{"location":"NYC"}' },
							},
						],
					},
				]),
			],
		});

		const res = await requestStreamingMessages(app, {});
		assert.equal(res.status, 200);

		const events = parseSSE(await res.text());

		assert.deepEqual(
			events.map((e) => e.event),
			[
				"message_start",
				"content_block_start",
				"ping",
				"content_block_stop",
				"content_block_start",
				"content_block_delta",
				"content_block_stop",
				"message_delta",
				"message_stop",
			],
		);

		const toolBlockStart = events[4]!;
		const toolBlockDelta = events[5]!;
		const toolBlockStop = events[6]!;
		const messageDelta = events[7]!;

		assert.deepEqual(toolBlockStart.data, {
			type: "content_block_start",
			index: 1,
			content_block: {
				type: "tool_use",
				id: "toolu_abc123",
				name: "get_weather",
				input: {},
			},
		});

		assert.deepEqual(toolBlockDelta.data, {
			type: "content_block_delta",
			index: 1,
			delta: { type: "input_json_delta", partial_json: '{"location":"NYC"}' },
		});

		assert.deepEqual(toolBlockStop.data, { type: "content_block_stop", index: 1 });

		assert.deepEqual(messageDelta.data, {
			type: "message_delta",
			delta: { stop_reason: "tool_use", stop_sequence: null },
			usage: { output_tokens: 10 },
		});
	});

	it("maps every finishReason to its Anthropic stop_reason in the streamed message_delta", async () => {
		const cases: Array<[InternalLLMChunk["finishReason"], string]> = [
			["stop", "end_turn"],
			["length", "max_tokens"],
			["tool_calls", "tool_use"],
			["content_filter", "end_turn"],
			["error", "end_turn"],
		];

		for (const [finishReason, expectedStopReason] of cases) {
			const app = buildStreamingApp({
				resolveStreamingProviders: async () => [
					fakeStreamingCandidate([{ content: "x", done: false }, { content: "", done: true, finishReason }]),
				],
			});

			const res = await requestStreamingMessages(app, {});
			const events = parseSSE(await res.text());
			const messageDelta = events.find((e) => e.event === "message_delta");
			assert.ok(messageDelta, `finishReason=${finishReason} produced no message_delta`);
			const delta = messageDelta.data["delta"] as Record<string, unknown>;
			assert.equal(delta["stop_reason"], expectedStopReason, `finishReason=${finishReason}`);
		}
	});

	it("falls back to a one-shot non-streaming call when no streaming provider is available", async () => {
		const app = buildStreamingApp({
			resolveStreamingProviders: async () => [],
			generateFromInternal: async () => ({
				content: "fallback text",
				model: "claude-opus-4",
				usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
				finishReason: "stop",
			}),
		});

		const res = await requestStreamingMessages(app, {});
		assert.equal(res.status, 200);

		const events = parseSSE(await res.text());
		assert.deepEqual(
			events.map((e) => e.event),
			[
				"message_start",
				"content_block_start",
				"ping",
				"content_block_delta",
				"content_block_stop",
				"message_delta",
				"message_stop",
			],
		);

		const messageStart = events[0]!;
		const message = messageStart.data["message"] as Record<string, unknown>;
		assert.deepEqual(message["usage"], { input_tokens: 7, output_tokens: 0 });

		const delta = events[3]!;
		assert.deepEqual(delta.data, {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "fallback text" },
		});

		const messageDelta = events[5]!;
		assert.deepEqual(messageDelta.data, {
			type: "message_delta",
			delta: { stop_reason: "end_turn", stop_sequence: null },
			usage: { output_tokens: 3 },
		});
	});

	it("responds with a normal (non-SSE) JSON error when every provider fails before the first chunk", async () => {
		const app = buildStreamingApp({
			resolveStreamingProviders: async () => [
				fakeStreamingCandidate(async function* () {
					throw new Error("connection refused");
					// eslint-disable-next-line no-unreachable
					yield { content: "", done: true } as InternalLLMChunk;
				}),
			],
		});

		const res = await requestStreamingMessages(app, {});

		assert.equal(res.status, 500);
		assert.doesNotMatch(res.headers.get("content-type") ?? "", /text\/event-stream/);

		const body = (await res.json()) as { type: string; error: { type: string; message: string } };
		assert.equal(body.type, "error");
		assert.equal(body.error.type, "api_error");
		assert.match(body.error.message, /connection refused/);
	});

	it("emits an `error` SSE event and closes the stream when the provider fails mid-stream", async () => {
		const app = buildStreamingApp({
			resolveStreamingProviders: async () => [
				fakeStreamingCandidate(async function* () {
					yield { content: "partial", done: false };
					throw new Error("provider dropped connection");
				}),
			],
		});

		const res = await requestStreamingMessages(app, {});

		// Already committed to SSE by the time the mid-stream failure happens.
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

		const events = parseSSE(await res.text());

		assert.deepEqual(
			events.map((e) => e.event),
			["message_start", "content_block_start", "ping", "content_block_delta", "content_block_stop", "error"],
		);

		const errorEvent = events.at(-1)!;
		assert.equal(errorEvent.data["type"], "error");
		const error = errorEvent.data["error"] as Record<string, unknown>;
		assert.equal(error["type"], "api_error");
		assert.match(error["message"] as string, /provider dropped connection/);
	});
});
