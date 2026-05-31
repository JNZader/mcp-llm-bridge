import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GenerateResponse } from "../src/core/types.js";
import { createStreamExecutor } from "../src/server/streaming/stream-executor.js";
import type { InternalLLMChunk } from "../src/transformers/streaming.js";

function createCanonicalRequest() {
	return {
		model: "test-model",
		messages: [{ role: "user" as const, content: "hello" }],
		stream: true,
	};
}

describe("createStreamExecutor", () => {
	it("falls back to router.generate when no streaming providers resolve", async () => {
		const events: string[] = [];
		const fallbackResult: GenerateResponse = {
			text: "fallback",
			provider: "mock",
			model: "test-model",
			resolvedProvider: "mock",
			resolvedModel: "test-model",
			fallbackUsed: false,
			tokensUsed: 3,
		};

		const executor = createStreamExecutor({
			canonical: createCanonicalRequest(),
			router: {
				resolveStreamingProviders: async () => [],
				generate: async () => fallbackResult,
			} as never,
		});

		await executor.execute({
			writeChunk: async () => {
				assert.fail("should not write streaming chunks during fallback");
			},
			writeFallbackResult: async (result) => {
				events.push(`fallback:${result.text}`);
			},
			writeTerminalError: async () => {
				assert.fail("should not emit error during fallback success");
			},
			writeDone: async () => {
				events.push("done");
			},
		});

		assert.deepEqual(events, ["fallback:fallback", "done"]);
	});

	it("buffers empty pre-content chunks until meaningful content arrives", async () => {
		const observedChunks: InternalLLMChunk[] = [];
		let providerIndex = 0;

		const executor = createStreamExecutor({
			canonical: createCanonicalRequest(),
			router: {
				resolveStreamingProviders: async () => [
					{
						provider: { id: "first-provider" },
						request: { model: "test-model", messages: [] },
						streamTransformer: {
							name: "first-provider",
							async *transformStream() {
								providerIndex += 1;
								yield { content: "", done: false };
								throw new Error("startup failure");
							},
						},
						recordResult: () => {},
					},
					{
						provider: { id: "second-provider" },
						request: { model: "test-model", messages: [] },
						streamTransformer: {
							name: "second-provider",
							async *transformStream() {
								providerIndex += 1;
								yield { content: "", done: false };
								yield { content: "ready", done: false };
								yield { content: "", done: true, finishReason: "stop" };
							},
						},
						recordResult: () => {},
					},
				],
				generate: async () => {
					assert.fail("should not use non-streaming fallback");
				},
			} as never,
		});

		await executor.execute({
			writeChunk: async (chunk) => {
				observedChunks.push(chunk);
			},
			writeFallbackResult: async () => {
				assert.fail("should not use fallback result");
			},
			writeTerminalError: async () => {
				assert.fail("should not emit terminal error");
			},
			writeDone: async () => {},
		});

		assert.equal(providerIndex, 2);
		assert.deepEqual(
			observedChunks.map((chunk) => ({ content: chunk.content, done: chunk.done })),
			[
				{ content: "", done: false },
				{ content: "ready", done: false },
				{ content: "", done: true },
			],
		);
	});

	it("does not fail over after meaningful content has been emitted", async () => {
		const observed: string[] = [];
		let recoveryProviderCalls = 0;

		const executor = createStreamExecutor({
			canonical: createCanonicalRequest(),
			router: {
				resolveStreamingProviders: async () => [
					{
						provider: { id: "primary-provider" },
						request: { model: "test-model", messages: [] },
						streamTransformer: {
							name: "primary-provider",
							async *transformStream() {
								yield { content: "partial", done: false };
								throw new Error("mid-stream failure");
							},
						},
						recordResult: () => {},
					},
					{
						provider: { id: "recovery-provider" },
						request: { model: "test-model", messages: [] },
						streamTransformer: {
							name: "recovery-provider",
							async *transformStream() {
								recoveryProviderCalls += 1;
								yield { content: "should-not-run", done: false };
							},
						},
						recordResult: () => {},
					},
				],
				generate: async () => {
					assert.fail("should not use router.generate");
				},
			} as never,
		});

		await executor.execute({
			writeChunk: async (chunk) => {
				observed.push(`chunk:${chunk.content}`);
			},
			writeFallbackResult: async () => {
				assert.fail("should not use fallback result");
			},
			writeTerminalError: async (error) => {
				observed.push(`error:${error.message}`);
				observed.push("done");
			},
			writeDone: async () => {
				assert.fail("should not write done separately after terminal error");
			},
		});

		assert.equal(recoveryProviderCalls, 0);
		assert.deepEqual(observed, ["chunk:partial", "error:mid-stream failure", "done"]);
	});
});
