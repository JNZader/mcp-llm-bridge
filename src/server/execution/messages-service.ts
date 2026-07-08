/**
 * Non-streaming execution service for the Anthropic Messages API route
 * (`POST /v1/messages`).
 *
 * Mirrors the shape of chat-completions-service.ts: parses/normalizes the
 * inbound request, dispatches through the shared Router, and builds an
 * Anthropic-shaped response from the provider-agnostic InternalLLMResponse.
 *
 * Streaming (`stream: true`) is NOT handled here — see routes/messages.ts.
 * SSE support is planned for 3b-2.
 */

import { randomUUID } from "node:crypto";

import type { InternalLLMResponse } from "../../core/internal-model.js";
import type { Router } from "../../core/router.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import { anthropicInbound } from "../../transformers/inbound/anthropic.js";
import type { RequestScope } from "../http-helpers/request-scope.js";

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
