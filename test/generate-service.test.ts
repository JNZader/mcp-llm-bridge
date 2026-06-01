import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Context } from "hono";

import { executeGenerateRequest } from "../src/server/execution/generate-service.js";

describe("generate-service", () => {
	it("prepares the generate request, executes it, and logs success", async () => {
		const captured: Array<Record<string, unknown>> = [];
		const logCtx = { provider: "", model: "", startTime: 0 };
		const context = {
			req: {
				header: (name: string) =>
					name === "X-Project" ? "header-project" : undefined,
			},
		} as Context;

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
			context,
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
						resolvedProvider: "mock-provider",
						resolvedModel: "gpt-4o-mini",
						fallbackUsed: false,
					};
				},
			} as never,
		});

		assert.deepEqual(captured, [
			{
				phase: "start",
				provider: "openai",
				model: "gpt-4o-mini",
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
				outputTokens: 9,
				responseData: JSON.stringify({
					text: "Strict mode catches more bugs.",
					provider: "mock-provider",
					model: "gpt-4o-mini",
					tokensUsed: 9,
					resolvedProvider: "mock-provider",
					resolvedModel: "gpt-4o-mini",
					fallbackUsed: false,
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
		});
	});

	it("logs failures and rethrows the router error", async () => {
		const captured: Array<Record<string, unknown>> = [];
		const failure = new Error("router blew up");
		const context = {
			req: {
				header: () => undefined,
			},
		} as Context;

		await assert.rejects(
			() =>
				executeGenerateRequest({
					validated: {
						prompt: "Hello world",
					},
					context,
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
								outputTokens?: number;
								responseData?: string;
								error?: Error;
							},
						) => {
							captured.push({ phase: "end", error: input?.error?.message });
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
				startTime: 123,
			},
			{
				phase: "end",
				error: "router blew up",
			},
		]);
	});
});
