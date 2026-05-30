import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { CostTracker } from "../../core/cost-tracker.js";
import type { InternalLLMRequest } from "../../core/internal-model.js";
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
import { buildProviderStreamCall } from "../streaming/provider-stream-client.js";
import {
	createStreamingRequestLogFinalizer,
	finalizeStreamingAttemptFailure,
	finalizeStreamingAttemptSuccess,
	normalizeStreamingError,
} from "../streaming/stream-finalizer.js";

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
 * Resolves the best provider with a streaming transformer, opens an SSE
 * stream, and forwards transformed chunks in OpenAI-compatible SSE format.
 * Records cost after the stream completes.
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

	const internalMessages = canonical.messages.map((m) => ({
		role: m.role as "system" | "user" | "assistant",
		content: m.content,
	}));

	const internalRequest: InternalLLMRequest = {
		messages: internalMessages,
		model: canonical.model,
		maxTokens: canonical.max_tokens,
	};

	return streamSSE(c, async (stream) => {
		const streamStartTime = Date.now();
		const { logCtx, finalizeRequestLog } = createStreamingRequestLogFinalizer(
			requestLogger,
			canonical.model,
		);
		let inputTokens: number | undefined;
		let outputTokens: number | undefined;

		const abortHandler = () => {
			void finalizeRequestLog({
				inputTokens,
				outputTokens,
				error: new Error("Stream aborted by client"),
			});
		};

		c.req.raw.signal.addEventListener("abort", abortHandler, { once: true });

		try {
			const resolvedCandidates = await router.resolveStreamingProviders(
				internalRequest,
			);

			if (resolvedCandidates.length === 0) {
				let result;
				try {
					result = await router.generate({
						prompt: canonical.messages
							.filter((m) => m.role !== "system")
							.map((m) => m.content)
							.join("\n"),
						system:
							canonical.messages
								.filter((m) => m.role === "system")
								.map((m) => m.content)
								.join("\n") || undefined,
						model: canonical.model,
						maxTokens: canonical.max_tokens,
						project,
					});
				} catch (error) {
					await finalizeRequestLog({
						error: normalizeStreamingError(error),
					});
					throw error;
				}

				outputTokens = result.tokensUsed || 0;
				await finalizeRequestLog({
					outputTokens,
					responseData: result,
				});

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

				await stream.writeSSE({ data: "[DONE]" });
				return;
			}

			let lastStreamingError: Error | undefined;

			for (const resolved of resolvedCandidates) {
				const { provider, request: resolvedRequest, streamTransformer, recordResult } =
					resolved;
				let breakerModel = resolvedRequest.model || model || "unknown";
				let attemptInputTokens: number | undefined;
				let attemptOutputTokens: number | undefined;
				let emittedMeaningfulContent = false;
				const pendingChunks: string[] = [];
				if (logCtx) {
					logCtx.provider = provider.id;
					logCtx.model = breakerModel;
				}
				const streamRecorder = costTracker?.recordStream(
					provider.id,
					breakerModel,
					project,
				);

				try {
					const providerCall = buildProviderStreamCall(provider.id, vault, project);
					const chunks = streamTransformer.transformStream(
						resolvedRequest,
						providerCall,
					);

					for await (const chunk of chunks) {
						streamRecorder?.addChunk(
							{ tokensIn: chunk.tokensIn, tokensOut: chunk.tokensOut },
							chunk.content.length,
						);

						if (chunk.tokensIn !== undefined) {
							attemptInputTokens = chunk.tokensIn;
						}
						if (chunk.tokensOut !== undefined) {
							attemptOutputTokens = chunk.tokensOut;
						}
						if (chunk.model && logCtx) {
							logCtx.model = chunk.model;
							breakerModel = chunk.model;
						} else if (chunk.model) {
							breakerModel = chunk.model;
						}

						const payload = buildStreamingChunkPayload(chatId, model, chunk);
						const chunkHasContent = chunk.content.length > 0;

						if (!emittedMeaningfulContent && !chunkHasContent && !chunk.done) {
							pendingChunks.push(payload);
							continue;
						}

						if (!emittedMeaningfulContent && (chunkHasContent || chunk.done)) {
							emittedMeaningfulContent = chunkHasContent;
							for (const pendingChunk of pendingChunks) {
								await stream.writeSSE({ data: pendingChunk });
							}
						}

						await stream.writeSSE({ data: payload });
					}

					inputTokens = attemptInputTokens;
					outputTokens = attemptOutputTokens;
					await stream.writeSSE({ data: "[DONE]" });
					await finalizeStreamingAttemptSuccess({
						providerId: provider.id,
						resolvedModel: breakerModel,
						streamStartTime,
						project,
						inputTokens,
						outputTokens,
						streamRecorder,
						recordResult,
						finalizeRequestLog,
						responseModel: logCtx?.model,
					});
					return;
				} catch (error) {
					const resolvedError = await finalizeStreamingAttemptFailure({
						providerId: provider.id,
						resolvedModel: breakerModel,
						streamStartTime,
						project,
						inputTokens: attemptInputTokens,
						outputTokens: attemptOutputTokens,
						streamRecorder,
						recordResult,
						error,
						emittedMeaningfulContent,
						finalizeRequestLog,
					});
					const message = resolvedError.message;

					if (!emittedMeaningfulContent) {
						lastStreamingError = resolvedError;
						continue;
					}

					inputTokens = attemptInputTokens;
					outputTokens = attemptOutputTokens;

					try {
						await stream.writeSSE({
							data: JSON.stringify({
								error: { message, type: "server_error", code: null },
							}),
						});
						await stream.writeSSE({ data: "[DONE]" });
					} catch {
						// Stream may already be closed
					}
					return;
				}
			}

			const resolvedError = lastStreamingError ?? new Error("No streaming providers available");
			await finalizeRequestLog({ error: resolvedError });

			try {
				await stream.writeSSE({
					data: JSON.stringify({
						error: { message: resolvedError.message, type: "server_error", code: null },
					}),
				});
				await stream.writeSSE({ data: "[DONE]" });
			} catch {
				// Stream may already be closed
			}
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
