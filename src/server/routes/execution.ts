import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { CostTracker } from "../../core/cost-tracker.js";
import type { Router } from "../../core/router.js";
import { validateChatCompletions, validateGenerateRequest } from "../../core/schemas.js";
import { createCanonicalResponse } from "../../protocol-converter/index.js";
import type { CanonicalRequest } from "../../protocol-converter/types.js";
import type { Vault } from "../../vault/vault.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import {
	getValidationIssue,
	jsonChatInvalidRequestError,
	jsonChatValidationError,
	jsonGenerateValidationError,
} from "../http-helpers/request-validation.js";
import {
	CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED,
} from "../http-helpers/chat-request.js";
import {
	executeNonStreamingChatCompletions,
	prepareChatCompletionsRequest,
} from "../execution/chat-completions-service.js";
import { executeGenerateRequest } from "../execution/generate-service.js";
import { createStreamExecutor } from "../streaming/stream-executor.js";
import { buildSSEChunkEvent } from "../../transformers/streaming.js";

export interface ExecutionRouteDeps {
	router: Router;
	vault: Vault;
	costTracker?: CostTracker;
	requestLogger?: RequestLogger;
}

function getCorrelationId(context: Context): string | undefined {
	const value = (context as { get: (key: string) => unknown }).get("correlationId");
	return typeof value === "string" ? value : undefined;
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
	router: Router,
	costTracker?: CostTracker,
	vault?: Vault,
	requestLogger?: RequestLogger,
): Response {
	const chatId = `chatcmpl-${randomUUID()}`;
	const model = canonical.model ?? "";
	const project = c.req.header("X-Project") ?? undefined;
	const requestCorrelationId = getCorrelationId(c);

	return streamSSE(c, async (stream) => {
		const executor = createStreamExecutor({
			canonical,
			router,
			costTracker,
			vault,
			requestLogger,
			project,
			correlationId: requestCorrelationId,
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
					const canonicalResponse = createCanonicalResponse(
						chatId,
						result.model,
						result.text,
						{ prompt: 0, completion: result.tokensUsed ?? 0 },
					);

					await stream.writeSSE({
						data: JSON.stringify({
							...canonicalResponse,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							choices: [
								{
									index: 0,
									delta: { content: result.text },
									finish_reason: "stop",
								},
							],
						}),
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
					context: c,
					router,
					requestLogger,
				}),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
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
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return jsonChatInvalidRequestError(c, message, null);
			}

			if (preparedRequest.canonicalRequest.stream) {
				return handleStreamingRequest(
					c,
					preparedRequest.optimizedCanonicalRequest,
					router,
					costTracker,
					vault,
					requestLogger,
				);
			}

			try {
				return c.json(
					await executeNonStreamingChatCompletions({
						prepared: preparedRequest,
						router,
						project: c.req.header("X-Project") ?? undefined,
						correlationId: getCorrelationId(c),
						requestLogger,
					}),
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message === CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED) {
					return jsonChatInvalidRequestError(c, message, "messages");
				}
				throw error;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: {
						message,
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
