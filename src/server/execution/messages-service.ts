/**
 * Execution service for the Anthropic Messages API route (`POST /v1/messages`).
 *
 * Mirrors the shape of chat-completions-service.ts: parses/normalizes the
 * inbound request, dispatches through the shared Router, and builds an
 * Anthropic-shaped response from the provider-agnostic InternalLLMResponse.
 *
 * Also contains the 3b-2 SSE streaming path (`executeStreamingMessages`) —
 * see routes/messages.ts for the HTTP/SSE wiring on top of it.
 */

import { randomUUID } from "node:crypto";

import type { InternalLLMChunk } from "../../transformers/streaming.js";
import type { InternalLLMResponse } from "../../core/internal-model.js";
import type { Router } from "../../core/router.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import { anthropicInbound } from "../../transformers/inbound/anthropic.js";
import type { RequestScope } from "../http-helpers/request-scope.js";
import type { Vault } from "../../vault/vault.js";
import { buildProviderStreamCall } from "../streaming/provider-stream-client.js";

export interface PreparedMessagesRequest {
	internalRequest: ReturnType<typeof anthropicInbound.transformRequest>;
	model?: string;
}

/**
 * Parse a raw Anthropic Messages API request body into an InternalLLMRequest
 * using the shared anthropicInbound transformer, then layer in scope metadata
 * (project/apiKeyId/userId) the same way the chat-completions path does.
 *
 * Throws `TransformError` (from core/transformer.js) on malformed input —
 * callers are expected to catch it and map to an Anthropic-shaped 400.
 */
export function prepareMessagesRequest(
	body: unknown,
	scope?: RequestScope,
): PreparedMessagesRequest {
	const internalRequest = anthropicInbound.transformRequest(body);

	const metadata: Record<string, unknown> = { ...(internalRequest.metadata ?? {}) };
	if (scope?.project) metadata["project"] = scope.project;
	if (scope?.apiKeyId) metadata["apiKeyId"] = scope.apiKeyId;
	if (scope?.userId) metadata["userId"] = scope.userId;

	return {
		internalRequest: {
			...internalRequest,
			...(Object.keys(metadata).length > 0 ? { metadata } : {}),
		},
		model: internalRequest.model,
	};
}

// ── finishReason (internal) -> stop_reason (Anthropic) ──────

const STOP_REASON_MAP: Record<string, string> = {
	stop: "end_turn",
	length: "max_tokens",
	tool_calls: "tool_use",
	content_filter: "end_turn",
	error: "end_turn",
};

export function mapFinishReasonToStopReason(finishReason: string): string {
	return STOP_REASON_MAP[finishReason] ?? "end_turn";
}

// ── Response builder ─────────────────────────────────────────

export interface AnthropicMessageResponse {
	id: string;
	type: "message";
	role: "assistant";
	model: string;
	content: Array<{ type: "text"; text: string }>;
	stop_reason: string;
	stop_sequence: null;
	usage: { input_tokens: number; output_tokens: number };
}

/**
 * Build the Anthropic Messages API response shape from an internal result.
 *
 * NOTE on usage: Anthropic requires input_tokens/output_tokens as numbers.
 * When the internal usage is unknown (both undefined), this serializes 0/0
 * for the HTTP response only — it does NOT touch the internal usage object
 * or recordUsage/cost-tracking, which stay truthful (unknown stays unknown
 * internally; only the wire format to the Anthropic client is coerced).
 */
export function buildAnthropicMessageResponse(input: {
	result: InternalLLMResponse;
	messageId?: string;
}): AnthropicMessageResponse {
	const { result, messageId = `msg_${randomUUID()}` } = input;

	return {
		id: messageId,
		type: "message",
		role: "assistant",
		model: result.model,
		content: [{ type: "text", text: result.content }],
		stop_reason: mapFinishReasonToStopReason(result.finishReason),
		stop_sequence: null,
		usage: {
			input_tokens: result.usage.inputTokens ?? 0,
			output_tokens: result.usage.outputTokens ?? 0,
		},
	};
}

// ── Execution ─────────────────────────────────────────────────

export interface ExecuteNonStreamingMessagesInput {
	prepared: PreparedMessagesRequest;
	router: Router;
	requestLogger?: RequestLogger;
	now?: () => number;
	createMessageId?: () => string;
}

export async function executeNonStreamingMessages(
	input: ExecuteNonStreamingMessagesInput,
): Promise<AnthropicMessageResponse> {
	const {
		prepared,
		router,
		requestLogger,
		now = Date.now,
		createMessageId = () => `msg_${randomUUID()}`,
	} = input;

	const logCtx = requestLogger?.captureStart({
		provider: "unknown",
		model: prepared.model || "unknown",
		startTime: now(),
	});

	try {
		const result = await router.generateFromInternal(prepared.internalRequest);

		if (logCtx && requestLogger) {
			await requestLogger.captureEnd(logCtx, {
				provider:
					readMetadataString(result.metadata, "resolvedProvider") ??
					readMetadataString(result.metadata, "provider"),
				model: readMetadataString(result.metadata, "resolvedModel") ?? result.model,
				totalTokens: result.usage.totalTokens,
				inputTokens: result.usage.inputTokens,
				outputTokens: result.usage.outputTokens,
				attempts: 1,
				responseData: JSON.stringify(result),
			});
		}

		return buildAnthropicMessageResponse({ result, messageId: createMessageId() });
	} catch (error) {
		if (logCtx && requestLogger) {
			await requestLogger.captureEnd(logCtx, {
				attempts: 1,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
		throw error;
	}
}

function readMetadataString(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" ? value : undefined;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

async function* toAsyncIterable<T>(items: readonly T[]): AsyncGenerator<T> {
	for (const item of items) {
		yield item;
	}
}

// ── Streaming (3b-2) ──────────────────────────────────────────

/**
 * A single Anthropic Messages SSE event: `event: <event>\ndata: <JSON of data>\n\n`.
 *
 * `data` is a plain object here — the HTTP layer (routes/messages.ts) is
 * responsible for `JSON.stringify`-ing it and writing the actual SSE frame,
 * so this module stays transport-agnostic and unit-testable without HTTP.
 */
export interface AnthropicSSEEvent {
	event: string;
	data: Record<string, unknown>;
}

export interface ExecuteStreamingMessagesInput {
	prepared: PreparedMessagesRequest;
	router: Router;
	vault?: Vault;
	scope?: RequestScope;
	requestLogger?: RequestLogger;
	now?: () => number;
	createMessageId?: () => string;
	createToolUseId?: () => string;
	providerStreamCallFactory?: typeof buildProviderStreamCall;
}

/**
 * Drive the Anthropic Messages SSE event sequence for a `stream: true` request.
 *
 * Two phases:
 *
 * 1. PRE-FLIGHT (before the first `yield`): resolve streaming-capable
 *    providers and pull the FIRST chunk out of the winning candidate's
 *    stream. If this fails for every candidate (or the non-streaming
 *    fallback call fails), this function THROWS instead of yielding —
 *    callers must treat a throw from the first `.next()` call as a
 *    pre-flight failure and respond with a normal (non-SSE) HTTP error,
 *    since nothing has been written to the client yet.
 *
 * 2. COMMITTED (from `message_start` onward): once we have a live first
 *    chunk, every subsequent failure is surfaced as a yielded `error` SSE
 *    event (never a throw) so the caller can close the connection cleanly
 *    instead of leaving the client hanging on a broken stream.
 */
export async function* executeStreamingMessages(
	input: ExecuteStreamingMessagesInput,
): AsyncGenerator<AnthropicSSEEvent> {
	const {
		prepared,
		router,
		vault,
		scope,
		requestLogger,
		now = Date.now,
		createMessageId = () => `msg_${randomUUID()}`,
		createToolUseId = () => `toolu_${randomUUID()}`,
		providerStreamCallFactory = buildProviderStreamCall,
	} = input;

	const messageId = createMessageId();
	const fallbackModel = prepared.model || "unknown";
	const logCtx = requestLogger?.captureStart({
		provider: "unknown",
		model: fallbackModel,
		startTime: now(),
	});

	let chunkIterator: AsyncIterator<InternalLLMChunk>;
	let firstChunkResult: IteratorResult<InternalLLMChunk>;
	let resolvedProvider: string | undefined;
	let attempts = 1;
	// input_tokens for message_start: only known upfront in the non-streaming
	// fallback branch below (a completed InternalLLMResponse already has usage).
	// For a true provider stream, tokensIn is only reported on the terminal
	// chunk (see outbound/anthropic-stream.ts and outbound/openai-stream.ts),
	// so message_start conservatively reports 0 there — a documented
	// limitation, not a bug (same "unknown stays 0 on the wire" convention as
	// the non-streaming path).
	let messageStartInputTokens = 0;

	const candidates = await router.resolveStreamingProviders(prepared.internalRequest);

	if (candidates.length === 0) {
		// No streaming-capable provider registered for this request — fall back to
		// a single non-streaming call and present its result as a (single-chunk)
		// stream. Mirrors the /v1/chat/completions streaming fallback behavior.
		let result: InternalLLMResponse;
		try {
			result = await router.generateFromInternal(prepared.internalRequest);
		} catch (error) {
			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, { attempts, error: toError(error) });
			}
			throw error;
		}

		const syntheticChunks: InternalLLMChunk[] = [
			{ content: result.content, done: false, model: result.model },
			{
				content: "",
				done: true,
				model: result.model,
				finishReason: result.finishReason,
				tokensIn: result.usage.inputTokens,
				tokensOut: result.usage.outputTokens,
				...(result.toolCalls && result.toolCalls.length > 0
					? { toolCalls: result.toolCalls }
					: {}),
			},
		];

		messageStartInputTokens = result.usage.inputTokens ?? 0;
		chunkIterator = toAsyncIterable(syntheticChunks);
		firstChunkResult = await chunkIterator.next();
		resolvedProvider =
			readMetadataString(result.metadata, "resolvedProvider") ??
			readMetadataString(result.metadata, "provider");
	} else {
		let lastError: unknown;
		let opened:
			| {
					iterator: AsyncIterator<InternalLLMChunk>;
					first: IteratorResult<InternalLLMChunk>;
					providerId: string;
			  }
			| undefined;

		for (let i = 0; i < candidates.length; i++) {
			const candidate = candidates[i];
			if (!candidate) continue;
			attempts = i + 1;
			candidate.executionContract.recordAttempt(candidate.provider.id);
			const attemptStartTime = now();

			try {
				const providerCall = providerStreamCallFactory(
					candidate.provider.id,
					vault,
					scope?.project,
					undefined,
				);
				const generator = candidate.streamTransformer.transformStream(
					candidate.request,
					providerCall,
				);
				const first = await generator.next();
				candidate.recordResult({
					model: candidate.request.model,
					latencyMs: now() - attemptStartTime,
					success: true,
					attempt: attempts,
					project: scope?.project,
				});
				candidate.onSuccess?.();
				opened = { iterator: generator, first, providerId: candidate.provider.id };
				break;
			} catch (error) {
				lastError = error;
				candidate.recordResult({
					latencyMs: now() - attemptStartTime,
					success: false,
					attempt: attempts,
					project: scope?.project,
					errorMessage: toError(error).message,
				});
			}
		}

		if (!opened) {
			const error = lastError ?? new Error("No streaming providers available");
			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, { attempts, error: toError(error) });
			}
			throw error;
		}

		chunkIterator = opened.iterator;
		firstChunkResult = opened.first;
		resolvedProvider = opened.providerId;
	}

	// ---- COMMITTED: from here on, failures become `error` events, never throws. ----

	let textBlockOpened = false;
	let textBlockClosed = false;
	let nextBlockIndex = 1;
	let finalInputTokens = 0;
	let finalOutputTokens = 0;
	let finalStopReason = "end_turn";
	let finalModel = fallbackModel;

	function* openTextBlockIfNeeded(): Generator<AnthropicSSEEvent> {
		if (textBlockOpened) return;
		textBlockOpened = true;
		yield {
			event: "content_block_start",
			data: {
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			},
		};
		yield { event: "ping", data: { type: "ping" } };
	}

	function* closeTextBlockIfNeeded(): Generator<AnthropicSSEEvent> {
		if (!textBlockOpened || textBlockClosed) return;
		textBlockClosed = true;
		yield { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } };
	}

	function* consumeChunk(chunk: InternalLLMChunk): Generator<AnthropicSSEEvent> {
		if (chunk.model) finalModel = chunk.model;

		yield* openTextBlockIfNeeded();

		if (chunk.content) {
			yield {
				event: "content_block_delta",
				data: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: chunk.content },
				},
			};
		}

		if (chunk.done) {
			yield* closeTextBlockIfNeeded();

			if (chunk.tokensIn !== undefined) finalInputTokens = chunk.tokensIn;
			if (chunk.tokensOut !== undefined) finalOutputTokens = chunk.tokensOut;
			finalStopReason = mapFinishReasonToStopReason(chunk.finishReason ?? "stop");

			for (const toolCall of chunk.toolCalls ?? []) {
				const index = nextBlockIndex++;
				yield {
					event: "content_block_start",
					data: {
						type: "content_block_start",
						index,
						content_block: {
							type: "tool_use",
							id: toolCall.id || createToolUseId(),
							name: toolCall.function.name,
							input: {},
						},
					},
				};
				yield {
					event: "content_block_delta",
					data: {
						type: "content_block_delta",
						index,
						delta: { type: "input_json_delta", partial_json: toolCall.function.arguments },
					},
				};
				yield { event: "content_block_stop", data: { type: "content_block_stop", index } };
			}
		}
	}

	yield {
		event: "message_start",
		data: {
			type: "message_start",
			message: {
				id: messageId,
				type: "message",
				role: "assistant",
				model: fallbackModel,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: messageStartInputTokens, output_tokens: 0 },
			},
		},
	};

	try {
		let current: IteratorResult<InternalLLMChunk> | undefined = firstChunkResult;
		while (current && !current.done) {
			const chunk = current.value;
			yield* consumeChunk(chunk);
			if (chunk.done) break;
			current = await chunkIterator.next();
		}
	} catch (error) {
		if (logCtx && requestLogger) {
			await requestLogger.captureEnd(logCtx, {
				provider: resolvedProvider,
				model: finalModel,
				attempts,
				error: toError(error),
			});
		}
		yield* closeTextBlockIfNeeded();
		yield {
			event: "error",
			data: {
				type: "error",
				error: { type: "api_error", message: toError(error).message },
			},
		};
		return;
	}

	yield {
		event: "message_delta",
		data: {
			type: "message_delta",
			delta: { stop_reason: finalStopReason, stop_sequence: null },
			usage: { output_tokens: finalOutputTokens },
		},
	};
	yield { event: "message_stop", data: { type: "message_stop" } };

	if (logCtx && requestLogger) {
		await requestLogger.captureEnd(logCtx, {
			provider: resolvedProvider,
			model: finalModel,
			totalTokens: finalInputTokens + finalOutputTokens,
			inputTokens: finalInputTokens,
			outputTokens: finalOutputTokens,
			attempts,
		});
	}
}
