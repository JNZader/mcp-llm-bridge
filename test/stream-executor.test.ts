import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Router } from "../src/core/router.js";
import { GroupStore } from "../src/core/groups.js";
import { SessionManager } from "../src/session/index.js";
import { TransformerRegistry } from "../src/core/transformer.js";
import type { GenerateResponse } from "../src/core/types.js";
import type { LLMProvider, ModelInfo } from "../src/core/types.js";
import type { ResolvedStreamingProvider } from "../src/core/router.js";
import { buildChatGenerateRequest } from "../src/server/http-helpers/chat-request.js";
import { createStreamExecutor } from "../src/server/streaming/stream-executor.js";
import type { InternalLLMChunk } from "../src/transformers/streaming.js";

function createCanonicalRequest() {
	return {
		model: "test-model",
		messages: [{ role: "user" as const, content: "hello" }],
		stream: true,
	};
}

function createProvider(id: string, modelId = "test-model"): LLMProvider {
	const model: ModelInfo = {
		id: modelId,
		name: modelId,
		provider: id,
		maxTokens: 4096,
	};

	return {
		id,
		name: id,
		type: "api",
		models: [model],
		async generate() {
			throw new Error("streaming test should not call generate");
		},
		async isAvailable() {
			return true;
		},
	};
}

describe("createStreamExecutor", () => {
	it("falls back cleanly with a bare Router and no transformer registry", async () => {
		const router = new Router();
		const logged: Array<{ error?: Error; responseData?: unknown }> = [];

		router.register({
			...createProvider("mock", "test-model"),
			async generate(request) {
				assert.equal(request.model, "test-model");
				assert.equal(request.strict, true);
				return {
					text: "fallback",
					provider: "mock",
					model: "test-model",
					resolvedProvider: "mock",
					resolvedModel: "test-model",
					fallbackUsed: false,
					tokensUsed: 3,
				};
			},
		});

		const events: string[] = [];
		const executor = createStreamExecutor({
			canonical: {
				...createCanonicalRequest(),
				strict: true,
			},
			router,
			scope: {},
			requestLogger: {
				captureStart: () => ({}) as never,
				captureEnd: async (_ctx: unknown, input?: { error?: Error; responseData?: unknown }) => {
					logged.push({ error: input?.error, responseData: input?.responseData });
				},
			} as never,
		});

		await executor.execute({
			writeChunk: async () => {
				assert.fail("should not write streaming chunks during fallback");
			},
			writeFallbackResult: async (result) => {
				events.push(`fallback:${result.text}`);
			},
			writeTerminalError: async (error) => {
				assert.fail(`unexpected terminal error: ${error.message}`);
			},
			writeDone: async () => {
				events.push("done");
			},
		});

		assert.deepEqual(events, ["fallback:fallback", "done"]);
		assert.equal(logged.length, 1);
		assert.equal(logged[0]?.error, undefined);
		assert.equal((logged[0]?.responseData as GenerateResponse | undefined)?.text, "fallback");
		assert.equal(
			(logged[0]?.responseData as GenerateResponse | undefined)?.resolvedProvider,
			"mock",
		);
	});

	it("falls back to router.generate when no streaming providers resolve", async () => {
		const events: string[] = [];
		const logged: Array<{
			provider?: string;
			model?: string;
			attempts?: number;
			totalTokens?: number;
			inputTokens?: number;
			outputTokens?: number;
			responseData?: unknown;
		}> = [];
		const canonical = {
			model: "test-model",
			messages: [
				{ role: "system" as const, content: "You are terse." },
				{ role: "user" as const, content: "First question" },
				{ role: "assistant" as const, content: "First answer" },
				{ role: "user" as const, content: "Second question" },
			],
			stream: true,
			max_tokens: 128,
		};
		const fallbackResult: GenerateResponse = {
			text: "fallback",
			provider: "mock",
			model: "test-model",
			requestedProvider: "preferred",
			requestedModel: "test-model",
			resolvedProvider: "mock",
			resolvedModel: "test-model",
			fallbackUsed: true,
			tokensUsed: 3,
			routing: {
				strategy: "failover",
				attemptedProviders: ["preferred", "mock"],
			},
		};
		const generateRequests: unknown[] = [];

		const executor = createStreamExecutor({
			canonical,
			router: {
				resolveStreamingProviders: async () => [],
				generate: async (request: unknown) => {
					generateRequests.push(request);
					return fallbackResult;
				},
			} as never,
			scope: { project: "stream-project" },
			requestLogger: {
				captureStart: () => ({}) as never,
				captureEnd: async (
					_ctx: unknown,
					input?: {
						provider?: string;
						model?: string;
						attempts?: number;
						totalTokens?: number;
						inputTokens?: number;
						outputTokens?: number;
						responseData?: unknown;
					},
				) => {
					logged.push({
						provider: input?.provider,
						model: input?.model,
						attempts: input?.attempts,
						totalTokens: input?.totalTokens,
						inputTokens: input?.inputTokens,
						outputTokens: input?.outputTokens,
						responseData: input?.responseData,
					});
				},
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
		assert.deepEqual(generateRequests, [buildChatGenerateRequest(canonical, { project: "stream-project" })]);
		assert.deepEqual(logged, [
			{
				provider: "mock",
				model: "test-model",
				attempts: 2,
				totalTokens: 3,
				inputTokens: undefined,
				outputTokens: undefined,
				responseData: fallbackResult,
			},
		]);
	});

	it("logs truthful routing metadata for successful streaming requests", async () => {
		const logged: Array<{
			provider?: string;
			model?: string;
			attempts?: number;
			responseData?: unknown;
		}> = [];

		const executor = createStreamExecutor({
			canonical: {
				...createCanonicalRequest(),
				provider: "primary-provider",
			},
			router: {
				resolveStreamingProviders: async () => [
					{
						provider: { id: "primary-provider" },
						request: { model: "primary-model", messages: [] },
						streamTransformer: {
							name: "primary-provider",
							async *transformStream() {
								throw new Error("primary failed");
							},
						},
						recordResult: () => {},
						routingMetadata: {
							strategy: "explicit-provider",
							decisionReason: "Provider primary-provider requested explicitly",
						},
					},
					{
						provider: { id: "backup-provider" },
						request: { model: "backup-model", messages: [] },
						streamTransformer: {
							name: "backup-provider",
							async *transformStream() {
								yield { content: "ok", done: false, model: "backup-model" };
								yield { content: "", done: true, finishReason: "stop" };
							},
						},
						recordResult: () => {},
						routingMetadata: {
							strategy: "explicit-provider",
							decisionReason: "Provider primary-provider requested explicitly",
						},
					},
				],
				generate: async () => {
					assert.fail("should not use router.generate");
				},
			} as never,
			requestLogger: {
				captureStart: () => ({}) as never,
				captureEnd: async (
					_ctx: unknown,
					input?: {
						provider?: string;
						model?: string;
						attempts?: number;
						responseData?: unknown;
					},
				) => {
					logged.push({
						provider: input?.provider,
						model: input?.model,
						attempts: input?.attempts,
						responseData: input?.responseData,
					});
				},
			} as never,
			scope: {},
		});

		await executor.execute({
			writeChunk: async () => {},
			writeFallbackResult: async () => {
				assert.fail("should not use fallback result");
			},
			writeTerminalError: async (error) => {
				assert.fail(`unexpected terminal error: ${error.message}`);
			},
			writeDone: async () => {},
		});

		assert.deepEqual(logged, [
			{
				provider: "backup-provider",
				model: "backup-model",
				attempts: 2,
				responseData: {
					stream: true,
					provider: "backup-provider",
					model: "backup-model",
					requestedProvider: "primary-provider",
					requestedModel: "test-model",
					resolvedProvider: "backup-provider",
					resolvedModel: "backup-model",
					fallbackUsed: true,
					routing: {
						strategy: "explicit-provider",
						attemptedProviders: ["primary-provider", "backup-provider"],
						fallbackFrom: "primary-provider",
						fallbackTo: "backup-provider",
						decisionReason: "Provider primary-provider requested explicitly",
					},
				},
			},
		]);
	});

	it("reuses shared chat metadata for streaming provider resolution", async () => {
		const requests: unknown[] = [];

		const executor = createStreamExecutor({
			canonical: {
				model: "test-model",
				messages: [{ role: "user", content: "hello" }],
				stream: true,
				provider: "openai",
				strict: true,
				clientId: "client-1",
			},
			router: {
				resolveStreamingProviders: async (request: unknown) => {
					requests.push(request);
					return [];
				},
				generate: async () => ({
					text: "fallback",
					provider: "mock",
					model: "test-model",
					resolvedProvider: "mock",
					resolvedModel: "test-model",
					fallbackUsed: false,
				}),
			} as never,
			scope: { project: "stream-project" },
		});

		await executor.execute({
			writeChunk: async () => {
				assert.fail("should not write streaming chunks during fallback");
			},
			writeFallbackResult: async () => {},
			writeTerminalError: async (error) => {
				assert.fail(`unexpected terminal error: ${error.message}`);
			},
			writeDone: async () => {},
		});

		assert.deepEqual(requests, [
			{
				messages: [{ role: "user", content: "hello" }],
				model: "test-model",
				maxTokens: undefined,
				metadata: {
					provider: "openai",
					clientId: "client-1",
					strict: true,
					project: "stream-project",
				},
			},
		]);
	});

	it("rejects assistant-only streaming requests with the shared chat guard", () => {
		assert.throws(
			() =>
				createStreamExecutor({
					canonical: {
						model: "test-model",
						messages: [{ role: "assistant", content: "hello" }],
						stream: true,
					},
					router: {
						resolveStreamingProviders: async () => {
							assert.fail("should not resolve providers for invalid chat input");
							return [];
						},
						generate: async () => {
							assert.fail("should not fall back for invalid chat input");
							return {
								text: "fallback",
								provider: "mock",
								model: "test-model",
								resolvedProvider: "mock",
								resolvedModel: "test-model",
								fallbackUsed: false,
							};
						},
					} as never,
					scope: {},
				}),
			/message is required/i,
		);
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
			scope: {},
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
			scope: {},
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

	it("finalizes locally, aborts upstream, and stops processing chunks after abort", async () => {
		const observedChunks: string[] = [];
		const loggedEnds: Array<{
			provider?: string;
			model?: string;
			attempts?: number;
			inputTokens?: number;
			outputTokens?: number;
			totalTokens?: number;
			error?: Error;
			responseData?: unknown;
		}> = [];
		const recordedResults: Array<{
			model?: string;
			totalTokens?: number;
			tokensIn?: number;
			tokensOut?: number;
			latencyMs: number;
			success: boolean;
			attempt?: number;
			project?: string;
			errorMessage?: string;
		}> = [];
		const passedSignals: AbortSignal[] = [];
		let releaseExtraChunks: (() => void) | undefined;
		let executor: ReturnType<typeof createStreamExecutor>;

		const extraChunksReady = new Promise<void>((resolve) => {
			releaseExtraChunks = resolve;
		});

		executor = createStreamExecutor({
			canonical: createCanonicalRequest(),
			router: {
				resolveStreamingProviders: async () => [
					{
						provider: { id: "abortable-provider" },
						request: { model: "test-model", messages: [] },
						streamTransformer: {
							name: "abortable-provider",
							async *transformStream(
								_request: unknown,
								providerCall: (request: unknown) => AsyncIterable<unknown>,
							) {
							for await (const chunk of providerCall({})) {
								yield chunk as InternalLLMChunk;
							}
						},
					},
					recordResult: (input: Parameters<ResolvedStreamingProvider["recordResult"]>[0]) => {
						recordedResults.push(input);
					},
					routingMetadata: {
						strategy: "direct",
						decisionReason: "Only abortable-provider was available",
					},
				},
			],
				generate: async () => {
					assert.fail("should not use router.generate");
				},
			} as never,
			requestLogger: {
				captureStart: () => ({}) as never,
				captureEnd: async (
					_ctx: unknown,
					input?: {
						provider?: string;
						model?: string;
						attempts?: number;
						inputTokens?: number;
						outputTokens?: number;
						totalTokens?: number;
						error?: Error;
						responseData?: unknown;
					},
				) => {
					loggedEnds.push({
						provider: input?.provider,
						model: input?.model,
						attempts: input?.attempts,
						inputTokens: input?.inputTokens,
						outputTokens: input?.outputTokens,
						totalTokens: input?.totalTokens,
						error: input?.error,
						responseData: input?.responseData,
					});
				},
			} as never,
			scope: { project: "abort-project" },
			providerStreamCallFactory,
		});

		await executor.execute({
			writeChunk: async (chunk) => {
				observedChunks.push(chunk.content || "<done>");
				if (chunk.content === "first") {
					await executor.abort();
					releaseExtraChunks?.();
				}
			},
			writeFallbackResult: async () => {
				assert.fail("should not use fallback result");
			},
			writeTerminalError: async () => {
				assert.fail("should not emit terminal error on abort");
			},
			writeDone: async () => {
				assert.fail("should not emit done on abort");
			},
		});

		assert.deepEqual(observedChunks, ["first"]);
		assert.deepEqual(loggedEnds, [
			{
				provider: "abortable-provider",
				model: "abort-model",
				attempts: 1,
				inputTokens: 2,
				outputTokens: 3,
				totalTokens: 5,
				error: new Error("Stream aborted by client"),
				responseData: {
					stream: true,
					provider: "abortable-provider",
					model: "abort-model",
					requestedProvider: undefined,
					requestedModel: "test-model",
					resolvedProvider: "abortable-provider",
					resolvedModel: "abort-model",
					fallbackUsed: false,
					routing: {
						strategy: "direct",
						attemptedProviders: ["abortable-provider"],
						decisionReason: "Only abortable-provider was available",
					},
				},
			},
		]);
		assert.equal(recordedResults.length, 1);
		assert.equal(recordedResults[0]?.model, "abort-model");
		assert.equal(recordedResults[0]?.tokensIn, 2);
		assert.equal(recordedResults[0]?.tokensOut, 3);
		assert.equal(recordedResults[0]?.totalTokens, 5);
		assert.equal(recordedResults[0]?.success, false);
		assert.equal(recordedResults[0]?.attempt, 1);
		assert.equal(recordedResults[0]?.project, "abort-project");
		assert.equal(recordedResults[0]?.errorMessage, "Stream aborted by client");
		assert.ok((recordedResults[0]?.latencyMs ?? 0) >= 0);
		assert.equal(passedSignals.length, 1);
		assert.equal(passedSignals[0]?.aborted, true);

		function createAbortError(): Error {
			const error = new Error("The operation was aborted");
			error.name = "AbortError";
			return error;
		}

		function providerStreamCallFactory(
			_providerId: string,
			_vault: unknown,
			_project: string | undefined,
			signal?: AbortSignal,
		): (request: unknown) => AsyncIterable<unknown> {
			assert.ok(signal, "executor should pass an AbortSignal upstream");
			passedSignals.push(signal);

			return () => ({
				[Symbol.asyncIterator]: async function* () {
					yield { content: "first", done: false, model: "abort-model", tokensIn: 2, tokensOut: 3 };
					await extraChunksReady;
					if (signal.aborted) {
						throw createAbortError();
					}
					yield { content: "late", done: false };
					yield { content: "", done: true, finishReason: "stop" };
				},
			});
		}
	});

	it("repins the sticky streaming session after a successful fallback", async () => {
		const router = new Router();
		const registry = new TransformerRegistry();
		const groupStore = new GroupStore(":memory:");
		const sessionManager = new SessionManager();
		const observedChunks: string[] = [];

		router.setTransformerRegistry(registry);
		router.setGroupStore(groupStore);
		router.setSessionManager(sessionManager);
		router.register(createProvider("openai", "sticky-model"));
		router.register(createProvider("anthropic", "sticky-model"));

		groupStore.create({
			name: "Sticky GPT",
			modelPattern: "sticky-*",
			members: [{ provider: "openai" }, { provider: "anthropic" }],
			strategy: "failover",
			stickyTTL: 30,
		});

		registry.registerStreamOutbound("openai", {
			name: "openai",
			async *transformStream() {
				throw new Error("openai startup failure");
			},
		});
		registry.registerStreamOutbound("anthropic", {
			name: "anthropic",
			async *transformStream() {
				yield { content: "fallback", done: false, model: "sticky-model" };
				yield { content: "", done: true, model: "sticky-model", finishReason: "stop" };
			},
		});

		sessionManager.pinRouterStickySession("client-1", "sticky-model", "openai", "default", 30_000);

		const executor = createStreamExecutor({
			canonical: {
				model: "sticky-model",
				messages: [{ role: "user", content: "hello" }],
				stream: true,
				clientId: "client-1",
			},
			router,
			scope: {},
		});

		await executor.execute({
			writeChunk: async (chunk) => {
				observedChunks.push(chunk.content);
			},
			writeFallbackResult: async () => {
				assert.fail("should not use non-streaming fallback");
			},
			writeTerminalError: async (error) => {
				assert.fail(`unexpected streaming error: ${error.message}`);
			},
			writeDone: async () => {},
		});

		assert.deepEqual(observedChunks, ["fallback", ""]);
		assert.equal(
			sessionManager.getRouterStickySession("client-1", "sticky-model")?.provider,
			"anthropic",
		);

		sessionManager.stopCleanup();
		groupStore.close();
	});

	it("uses the repinned provider first on the next streaming request", async () => {
		const router = new Router();
		const registry = new TransformerRegistry();
		const groupStore = new GroupStore(":memory:");
		const sessionManager = new SessionManager();

		router.setTransformerRegistry(registry);
		router.setGroupStore(groupStore);
		router.setSessionManager(sessionManager);
		router.register(createProvider("openai", "sticky-model"));
		router.register(createProvider("anthropic", "sticky-model"));

		groupStore.create({
			name: "Sticky GPT",
			modelPattern: "sticky-*",
			members: [{ provider: "openai" }, { provider: "anthropic" }],
			strategy: "failover",
			stickyTTL: 30,
		});

		registry.registerStreamOutbound("openai", {
			name: "openai",
			async *transformStream() {
				throw new Error("openai startup failure");
			},
		});
		registry.registerStreamOutbound("anthropic", {
			name: "anthropic",
			async *transformStream() {
				yield { content: "fallback", done: false, model: "sticky-model" };
				yield { content: "", done: true, model: "sticky-model", finishReason: "stop" };
			},
		});

		sessionManager.pinRouterStickySession("client-1", "sticky-model", "openai", "default", 30_000);

		const executor = createStreamExecutor({
			canonical: {
				model: "sticky-model",
				messages: [{ role: "user", content: "hello" }],
				stream: true,
				clientId: "client-1",
			},
			router,
			scope: {},
		});

		await executor.execute({
			writeChunk: async () => {},
			writeFallbackResult: async () => {
				assert.fail("should not use non-streaming fallback");
			},
			writeTerminalError: async (error) => {
				assert.fail(`unexpected streaming error: ${error.message}`);
			},
			writeDone: async () => {},
		});

		const nextCandidates = await router.resolveStreamingProviders({
			model: "sticky-model",
			messages: [{ role: "user", content: "hello again" }],
			metadata: { clientId: "client-1" },
		});

		assert.equal(nextCandidates[0]?.provider.id, "anthropic");

		sessionManager.stopCleanup();
		groupStore.close();
	});
});
