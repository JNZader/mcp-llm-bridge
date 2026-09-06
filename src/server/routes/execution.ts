import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { CostTracker } from "../../core/cost-tracker.js";
import { safeError, toSafeHttpError } from "../../core/safe-error.js";
import type { Router } from "../../core/router.js";
import { validateChatCompletions, validateGenerateRequest } from "../../core/schemas.js";
import {
	createOpenAIUsage,
} from "../../protocol-converter/index.js";
import type { CanonicalRequest } from "../../protocol-converter/types.js";
import type { ProviderStreamVaultPort } from "../streaming/provider-stream-client.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import {
	getValidationIssue,
	jsonChatInvalidRequestError,
	jsonChatValidationError,
	jsonGenerateValidationError,
} from "../http-helpers/request-validation.js";
import {
	resolveRequestScope,
	type RequestScope,
} from "../http-helpers/request-scope.js";
import {
	executeNonStreamingChatCompletions,
	prepareChatCompletionsRequest,
} from "../execution/chat-completions-service.js";
import { executeGenerateRequest } from "../execution/generate-service.js";
import { createStreamExecutor } from "../streaming/stream-executor.js";
import { buildSSEChunkEvent } from "../../transformers/streaming.js";

const INTERNAL_ERROR_MESSAGE = toSafeHttpError(safeError("INTERNAL_ERROR")).body.error;

export interface ExecutionRouteDeps {
	router: Router;
	vault: ProviderStreamVaultPort;
	costTracker?: CostTracker;
	requestLogger?: RequestLogger;
}

export function buildStreamingFallbackChunkResponse(input: {
	chatId: string;
	result: {
		text: string;
		model: string;
		tokensUsed?: number;
	};
	createdAtSeconds?: number;
}) {
	const { chatId, result, createdAtSeconds = Math.floor(Date.now() / 1000) } = input;
	const usage = createOpenAIUsage({ totalTokens: result.tokensUsed });
	const response = {
		id: chatId,
		model: result.model,
		object: "chat.completion.chunk",
		created: createdAtSeconds,
		choices: [
			{
				index: 0,
				delta: { content: result.text },
				finish_reason: "stop",
			},
		],
	};

	return usage ? { ...response, usage } : response;
}

/**
 * Handle a streaming chat completion request via SSE.
 *
	 * Opens an SSE stream and delegates streaming execution while keeping
	 * Hono-specific stream writes and abort wiring in the route layer.
 */
function handleStreamingRequest(
	c: Context,
	canonical: CanonicalRequest,
	scope: RequestScope,
	router: Router,
	costTracker?: CostTracker,
	vault?: ProviderStreamVaultPort,
	requestLogger?: RequestLogger,
): Response {
	const chatId = `chatcmpl-${randomUUID()}`;
	const model = canonical.model ?? "";

	return streamSSE(c, async (stream) => {
		const executor = createStreamExecutor({
			canonical,
			router,
			costTracker,
			vault,
			requestLogger,
			scope,
			abortSignal: c.req.raw.signal,
		});

		const abortHandler = () => {
			void executor.abort();
		};

		c.req.raw.signal.addEventListener("abort", abortHandler, { once: true });

		try {
			await executor.execute({
				writeChunk: async (chunk) => {
					await stream.writeSSE({
						data: JSON.stringify(buildSSEChunkEvent(chunk, chatId, model)),
					});
				},
				writeFallbackResult: async (result) => {
					await stream.writeSSE({
						data: JSON.stringify(
							buildStreamingFallbackChunkResponse({ chatId, result }),
						),
					});
				},
				writeTerminalError: async (error) => {
					try {
						await stream.writeSSE({
							data: JSON.stringify({
								error: { message: error.message, type: "server_error", code: null },
							}),
						});
						await stream.writeSSE({ data: "[DONE]" });
					} catch {
						// Stream may already be closed
					}
				},
				writeDone: async () => {
					await stream.writeSSE({ data: "[DONE]" });
				},
			});
		} finally {
			c.req.raw.signal.removeEventListener("abort", abortHandler);
		}
	});
}

export function registerExecutionRoutes(
	app: Hono,
	deps: ExecutionRouteDeps,
): void {
	const { router, vault, costTracker, requestLogger } = deps;

	app.post("/v1/generate", async (c) => {
		try {
			const body = await c.req.json();

			let validated: ReturnType<typeof validateGenerateRequest>;
			try {
				validated = validateGenerateRequest(body);
			} catch (error) {
				const issue = getValidationIssue(error);
				if (issue) {
					return jsonGenerateValidationError(c, issue);
				}
				throw error;
			}

			return c.json(
				await executeGenerateRequest({
					validated,
					scope: resolveRequestScope(c, validated.project),
					router,
					requestLogger,
				}),
			);
		} catch {
			return c.json({ error: INTERNAL_ERROR_MESSAGE }, 500);
		}
	});

	app.post("/v1/chat/completions", async (c) => {
		try {
			const body = await c.req.json();

			let validated: ReturnType<typeof validateChatCompletions>;
			try {
				validated = validateChatCompletions(body);
			} catch (error) {
				const issue = getValidationIssue(error);
				if (issue) {
					return jsonChatValidationError(c, issue);
				}
				throw error;
			}

			let preparedRequest;
			try {
				preparedRequest = prepareChatCompletionsRequest(validated);
			} catch {
				return jsonChatInvalidRequestError(c, "", null);
			}

			const scope = resolveRequestScope(c);

			if (preparedRequest.canonicalRequest.stream) {
				return handleStreamingRequest(
					c,
					preparedRequest.optimizedCanonicalRequest,
					scope,
					router,
					costTracker,
					vault,
					requestLogger,
				);
			}

			return c.json(
				await executeNonStreamingChatCompletions({
					prepared: preparedRequest,
					router,
					scope,
					requestLogger,
				}),
			);
		} catch {
			return c.json(
				{
					error: {
						message: INTERNAL_ERROR_MESSAGE,
						type: "server_error",
						param: null,
						code: null,
					},
				},
				500,
			);
		}
	});
}
