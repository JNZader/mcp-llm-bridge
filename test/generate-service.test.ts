import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { executeGenerateRequest } from "../src/server/execution/generate-service.js";

describe("generate-service", () => {
	it("forwards the optional execution signal without placing it in the request payload", async () => {
		const controller = new AbortController();
		const calls: unknown[][] = [];

		await executeGenerateRequest({
			validated: { prompt: "Hello" },
			scope: {},
			abortSignal: controller.signal,
			router: {
				generate: async (...args: unknown[]) => {
					calls.push(args);
					return {
						text: "ok", provider: "mock", model: "mock-model", resolvedProvider: "mock",
						resolvedModel: "mock-model", fallbackUsed: false,
					};
				},
			} as never,
		});

		assert.deepEqual(calls, [[
			{ prompt: "Hello", system: undefined, model: undefined, provider: undefined, maxTokens: undefined, strict: undefined, project: undefined, apiKeyId: undefined, userId: undefined },
			{ signal: controller.signal },
		]]);
	});

	it("prepares the generate request, executes it, and logs success", async () => {
		const captured: Array<Record<string, unknown>> = [];
		const logCtx = { provider: "", model: "", startTime: 0 };

		const result = await executeGenerateRequest({
			validated: {
				system: "Be terse.",
				context: "The project uses TypeScript.",
				instruction: "Explain strict mode.",
				model: "gpt-4o-mini",
				provider: "openai",
				maxTokens: 64,
				strict: true,
			},
			scope: {
				project: "header-project",
				apiKeyId: "key-123",
				userId: "user-456",
			},
			now: () => 1_700_000_000_000,
			requestLogger: {
				captureStart: (input: {
					provider: string;
					model: string;
					startTime: number;
				}) => {
					captured.push({ phase: "start", ...input });
					logCtx.provider = input.provider;
					logCtx.model = input.model;
					logCtx.startTime = input.startTime;
					return logCtx as never;
				},
				captureEnd: async (
					_ctx: unknown,
					input?: {
						provider?: string;
						model?: string;
						totalTokens?: number;
						attempts?: number;
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
						resolvedProvider: "mock-provider",
						resolvedModel: "gpt-4o-mini",
						fallbackUsed: false,
						routing: {
							strategy: "mock",
							attemptedProviders: ["first-provider", "mock-provider"],
						},
					};
				},
			} as never,
		});

		assert.deepEqual(captured, [
			{
				phase: "start",
				provider: "openai",
				model: "gpt-4o-mini",
				correlationId: undefined,
				startTime: 1_700_000_000_000,
			},
			{
				phase: "generate",
				request: {
					prompt: "[Context]\nThe project uses TypeScript.\n\n[Instruction]\nExplain strict mode.",
					system: "Be terse.",
					model: "gpt-4o-mini",
					provider: "openai",
					maxTokens: 64,
					strict: true,
					project: "header-project",
					apiKeyId: "key-123",
					userId: "user-456",
				},
			},
			{
				phase: "end",
				provider: "mock-provider",
				model: "gpt-4o-mini",
				totalTokens: 9,
				attempts: 2,
				responseData: JSON.stringify({
					text: "Strict mode catches more bugs.",
					provider: "mock-provider",
					model: "gpt-4o-mini",
					tokensUsed: 9,
					resolvedProvider: "mock-provider",
					resolvedModel: "gpt-4o-mini",
					fallbackUsed: false,
					routing: {
						strategy: "mock",
						attemptedProviders: ["first-provider", "mock-provider"],
					},
					stop_reason: "stop",
					finish_reason: "stop",
				}),
			},
		]);

		assert.deepEqual(result, {
			text: "Strict mode catches more bugs.",
			provider: "mock-provider",
			model: "gpt-4o-mini",
			tokensUsed: 9,
			resolvedProvider: "mock-provider",
			resolvedModel: "gpt-4o-mini",
			fallbackUsed: false,
			routing: {
				strategy: "mock",
				attemptedProviders: ["first-provider", "mock-provider"],
			},
			stop_reason: "stop",
			finish_reason: "stop",
		});
	});

	it("logs failures and rethrows the router error", async () => {
		const captured: Array<Record<string, unknown>> = [];
		const failure = new Error('router blew up {"api_key":"generate-secret","token":"generate-token"} Bearer generate-bearer');

		await assert.rejects(
			() =>
					executeGenerateRequest({
						validated: {
							prompt: "Hello world",
						},
						scope: {},
						now: () => 123,
					requestLogger: {
						captureStart: (input: {
							provider: string;
							model: string;
							startTime: number;
						}) => {
							captured.push({ phase: "start", ...input });
							return {} as never;
						},
						captureEnd: async (
							_ctx: unknown,
					input?: {
						provider?: string;
						model?: string;
						totalTokens?: number;
						attempts?: number;
						responseData?: string;
						error?: Error;
						},
				) => {
						captured.push({ phase: "end", attempts: input?.attempts, error: input?.error?.message });
					},
					} as never,
					router: {
						generate: async () => {
							throw failure;
						},
					} as never,
				}),
			failure,
		);

		assert.deepEqual(captured, [
			{
				phase: "start",
				provider: "unknown",
				model: "unknown",
				correlationId: undefined,
				startTime: 123,
			},
			{
				phase: "end",
				attempts: 1,
				error: 'router blew up {"api_key":[REDACTED],"token":[REDACTED]} Bearer [REDACTED]',
			},
		]);
	});

	it("adds catalog-derived zero-cost evidence only for complete zero-priced usage", async () => {
		const result = await executeGenerateRequest({
			validated: { prompt: "Hello", model: "opencode/muse-spark-1.3-contributor-free" },
			scope: {},
			router: {
				generate: async () => ({
					text: "ok", provider: "opencode-cli", model: "opencode/muse-spark-1.3-contributor-free",
					resolvedProvider: "opencode-cli", resolvedModel: "opencode/muse-spark-1.3-contributor-free",
					fallbackUsed: false,
					usageProvenance: { status: "reported", origin: "cli-output", eventCount: 1, inputTokens: 4, outputTokens: 6 },
				}),
			} as never,
		});

		assert.deepEqual(result.costEvidence, {
			status: "estimated_zero",
			source: "catalog_estimate",
			estimatedCost: 0,
			currency: "USD",
			inputTokens: 4,
			outputTokens: 6,
			providerChargeAttestation: false,
			caveat: "Estimated from gateway model-price metadata; not provider charge attestation.",
		});
		assert.equal(result.resolvedProvider, "opencode-cli");
		assert.equal(result.resolvedModel, "opencode/muse-spark-1.3-contributor-free");
		assert.equal(result.fallbackUsed, false);
	});

	it("omits cost evidence when usage is missing or model pricing is non-zero", async () => {
		const missing = await executeGenerateRequest({
			validated: { prompt: "Hello" }, scope: {},
			router: { generate: async () => ({ text: "ok", provider: "mock", model: "unknown", resolvedProvider: "mock", resolvedModel: "unknown", fallbackUsed: false }) } as never,
		});
		const nonZero = await executeGenerateRequest({
			validated: { prompt: "Hello", model: "gpt-4o-mini" }, scope: {},
			router: { generate: async () => ({ text: "ok", provider: "openai", model: "gpt-4o-mini", resolvedProvider: "openai", resolvedModel: "gpt-4o-mini", fallbackUsed: false, usageProvenance: { status: "reported", origin: "cli-output", eventCount: 1, inputTokens: 1, outputTokens: 1 } }) } as never,
		});
		assert.equal("costEvidence" in missing, false);
		assert.equal("costEvidence" in nonZero, false);
	});

	it("bounds large responses in the request log without changing the API result", async () => {
		const captured: Array<Record<string, unknown>> = [];
		const text = "x".repeat(20_000);

		const result = await executeGenerateRequest({
			validated: { prompt: "Hello world" },
			scope: {},
			requestLogger: {
				captureStart: () => ({ provider: "unknown", model: "unknown", startTime: 0 }) as never,
				captureEnd: async (_ctx: unknown, input?: { responseData?: string }) => {
					captured.push({ responseData: input?.responseData });
				},
			} as never,
			router: {
				generate: async () => ({
					text,
					provider: "mock-provider",
					model: "mock-model",
					resolvedProvider: "mock-provider",
					resolvedModel: "mock-model",
					tokensUsed: 1,
				}) as never,
			} as never,
		});

		assert.equal(result.text, text);
		assert.ok((captured[0]?.responseData as string).length <= 10_000);
	});
});
