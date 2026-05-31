import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { CostTracker } from "../../core/cost-tracker.js";
import type { Router } from "../../core/router.js";
import { validateChatCompletions, validateGenerateRequest } from "../../core/schemas.js";
import { optimizeMessages } from "../../transformers/three-part-prompt.js";
import {
	createCanonicalResponse,
	normalizeOpenAIRequest,
} from "../../protocol-converter/index.js";
import type { CanonicalRequest } from "../../protocol-converter/types.js";
import type { Vault } from "../../vault/vault.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import type { LogContext } from "../../logging/types.js";
import {
	getValidationIssue,
	jsonChatInvalidRequestError,
	jsonChatValidationError,
	jsonGenerateValidationError,
} from "../http-helpers/request-validation.js";
import {
	CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED,
	prepareChatGenerateRequest,
} from "../http-helpers/chat-request.js";
import { prepareGenerateRequest } from "../http-helpers/generate-request.js";
import { createStreamExecutor } from "../streaming/stream-executor.js";

export interface ExecutionRouteDeps {
	router: Router;
	vault: Vault;
	costTracker?: CostTracker;
	requestLogger?: RequestLogger;
}

function buildGatewayMetadata(result: {
	requestedProvider?: string;
	requestedModel?: string;
	resolvedProvider?: string;
	resolvedModel?: string;
	fallbackUsed?: boolean;
	tokensUsed?: number;
}) {
	return {
		requestedProvider: result.requestedProvider,
		requestedModel: result.requestedModel,
		resolvedProvider: result.resolvedProvider,
		resolvedModel: result.resolvedModel,
		fallbackUsed: result.fallbackUsed,
		tokensUsed: result.tokensUsed,
	};
}

function buildStreamingChunkPayload(
	chatId: string,
	model: string,
	chunk: {
		content: string;
		done: boolean;
		model?: string;
		finishReason?: string | null;
		tokensIn?: number;
		tokensOut?: number;
	},
): string {
	return JSON.stringify({
		id: chatId,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: chunk.model || model,
		choices: [
			{
				index: 0,
				delta: chunk.content ? { content: chunk.content } : {},
				finish_reason: chunk.done ? (chunk.finishReason ?? "stop") : null,
			},
		],
		...(chunk.done &&
		(chunk.tokensIn !== undefined || chunk.tokensOut !== undefined)
			? {
				usage: {
					prompt_tokens: chunk.tokensIn ?? 0,
					completion_tokens: chunk.tokensOut ?? 0,
					total_tokens: (chunk.tokensIn ?? 0) + (chunk.tokensOut ?? 0),
				},
			}
			: {}),
	});
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

	return streamSSE(c, async (stream) => {
		const executor = createStreamExecutor({
			canonical,
			router,
			costTracker,
			vault,
			requestLogger,
			project,
		});

		const abortHandler = () => {
			void executor.abort();
		};

		c.req.raw.signal.addEventListener("abort", abortHandler, { once: true });

		try {
			await executor.execute({
				writeChunk: async (chunk) => {
					await stream.writeSSE({
						data: buildStreamingChunkPayload(chatId, model, chunk),
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
		let logCtx: LogContext | undefined;
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

			const generateRequest = prepareGenerateRequest(validated, c);

			logCtx = requestLogger?.captureStart({
				provider: validated.provider || "unknown",
				model: validated.model || "unknown",
				startTime: Date.now(),
			});

			const result = await router.generate(generateRequest);

			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, {
					outputTokens: result.tokensUsed || 0,
					responseData: JSON.stringify(result),
				});
			}

			return c.json(result);
		} catch (error) {
			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, {
					error: error instanceof Error ? error : new Error(String(error)),
				});
			}
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.post("/v1/chat/completions", async (c) => {
		let logCtx: LogContext | undefined;
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

			let canonicalRequest: CanonicalRequest;
			try {
				canonicalRequest = normalizeOpenAIRequest(validated);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return jsonChatInvalidRequestError(c, message, null);
			}

			const internalMessages = canonicalRequest.messages.map((m) => ({
				role: m.role as "system" | "user" | "assistant" | "tool",
				content: m.content,
			}));
			const optimizedMessages = optimizeMessages(internalMessages);

			if (canonicalRequest.stream) {
				return handleStreamingRequest(
					c,
					{
						...canonicalRequest,
						messages: optimizedMessages.map((m) => ({
							role: m.role,
							content: typeof m.content === "string" ? m.content : "",
						})) as {
							role: "system" | "user" | "assistant";
							content: string;
						}[],
					},
					router,
					costTracker,
					vault,
					requestLogger,
				);
			}

			let generateRequest;
			try {
				generateRequest = prepareChatGenerateRequest(canonicalRequest, c);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message === CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED) {
					return jsonChatInvalidRequestError(c, message, "messages");
				}
				throw error;
			}

			logCtx = requestLogger?.captureStart({
				provider: "unknown",
				model: canonicalRequest.model || "unknown",
				startTime: Date.now(),
			});

			const result = await router.generate(generateRequest);

			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, {
					outputTokens: result.tokensUsed || 0,
					responseData: JSON.stringify(result),
				});
			}

			const canonicalResponse = createCanonicalResponse(
				`chatcmpl-${randomUUID()}`,
				result.model,
				result.text,
				{ prompt: 0, completion: result.tokensUsed ?? 0 },
			);

			return c.json({
				...canonicalResponse,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				x_gateway: buildGatewayMetadata(result),
			});
		} catch (error) {
			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, {
					error: error instanceof Error ? error : new Error(String(error)),
				});
			}
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
