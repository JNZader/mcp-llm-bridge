import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";

import { registerMessagesRoutes } from "../../../src/server/routes/messages.js";
import type { InternalLLMResponse } from "../../../src/core/internal-model.js";

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

	it("returns a 400 with a clear message for stream:true (not yet supported)", async () => {
		const app = buildApp(async () => {
			throw new Error("should not be called");
		});

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				max_tokens: 10,
				stream: true,
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		assert.equal(res.status, 400);
		const body = (await res.json()) as { type: string; error: { type: string; message: string } };
		assert.equal(body.type, "error");
		assert.match(body.error.message, /streaming not yet supported/);
		assert.match(body.error.message, /3b-2/);
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
