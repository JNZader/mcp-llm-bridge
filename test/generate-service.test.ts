import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { executeGenerateRequest } from "../src/server/execution/generate-service.js";

describe("generate-service", () => {
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
			scope: { project: "header-project" },
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
		});
	});

	it("logs failures and rethrows the router error", async () => {
		const captured: Array<Record<string, unknown>> = [];
		const failure = new Error("router blew up");

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
				error: "router blew up",
			},
		]);
	});
});
