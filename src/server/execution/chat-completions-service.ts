import { randomUUID } from "node:crypto";

import type { ChatCompletionsRequest } from "../../core/schemas.js";
import type { Router } from "../../core/router.js";
import type { GenerateResponse } from "../../core/types.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import {
	createCanonicalResponse,
	normalizeOpenAIRequest,
} from "../../protocol-converter/index.js";
import type { CanonicalRequest } from "../../protocol-converter/types.js";
import { optimizeMessages } from "../../transformers/three-part-prompt.js";
import {
	type ChatGenerateMessage,
	buildChatGenerateRequestFromMessages,
} from "../http-helpers/chat-request.js";

interface GatewayMetadataInput {
	requestedProvider?: string;
	requestedModel?: string;
	resolvedProvider?: string;
	resolvedModel?: string;
	fallbackUsed?: boolean;
	tokensUsed?: number;
	routing?: unknown;
}

interface NonStreamingChatLogger {
	requestLogger?: RequestLogger;
	startTimeMs: number;
	requestedModel?: string;
}

export interface PreparedChatCompletionsRequest {
	canonicalRequest: CanonicalRequest;
	optimizedCanonicalRequest: CanonicalRequest;
}

export interface ExecuteNonStreamingChatCompletionsInput {
	prepared: PreparedChatCompletionsRequest;
	router: Router;
	project?: string;
	requestLogger?: RequestLogger;
	now?: () => number;
	createChatCompletionId?: () => string;
}

export function prepareChatCompletionsRequest(
	validated: ChatCompletionsRequest,
): PreparedChatCompletionsRequest {
	const canonicalRequest = normalizeOpenAIRequest(validated);
	const normalizedOptimizedMessages = normalizeOptimizedMessages(
		optimizeMessages(
			canonicalRequest.messages.map((message) => ({
				role: message.role,
				content: message.content,
			})),
		),
	);

	return {
		canonicalRequest,
		optimizedCanonicalRequest: {
			...canonicalRequest,
			messages: normalizedOptimizedMessages,
		},
	};
}

function normalizeOptimizedMessages(
	messages: ReadonlyArray<{ role: string; content?: unknown }>,
): ChatGenerateMessage[] {
	const normalized: ChatGenerateMessage[] = [];

	for (const message of messages) {
		if (
			message.role !== "system" &&
			message.role !== "user" &&
			message.role !== "assistant"
		) {
			continue;
		}

		normalized.push({
			role: message.role,
			content: typeof message.content === "string" ? message.content : "",
		});
	}

	return normalized;
}

export async function executeNonStreamingChatCompletions(
	input: ExecuteNonStreamingChatCompletionsInput,
) {
	const {
		prepared,
		router,
		project,
		requestLogger,
		now = Date.now,
		createChatCompletionId = () => `chatcmpl-${randomUUID()}`,
	} = input;
	const logger = createNonStreamingLogger({
		requestLogger,
		startTimeMs: now(),
		requestedModel: prepared.canonicalRequest.model,
	});

	try {
		const result = await router.generate(
			buildChatGenerateRequestFromMessages(
				prepared.canonicalRequest,
				prepared.optimizedCanonicalRequest.messages,
				project,
			),
		);

		await finalizeNonStreamingSuccess(logger, result);

		return buildNonStreamingChatResponse({
			result,
			createdAtSeconds: Math.floor(now() / 1000),
			chatId: createChatCompletionId(),
		});
	} catch (error) {
		await finalizeNonStreamingFailure(logger, error);
		throw error;
	}
}

function createNonStreamingLogger(input: NonStreamingChatLogger) {
	const { requestLogger, startTimeMs, requestedModel } = input;
	return {
		requestLogger,
		logCtx: requestLogger?.captureStart({
			provider: "unknown",
			model: requestedModel || "unknown",
			startTime: startTimeMs,
		}),
	};
}

async function finalizeNonStreamingSuccess(
	logger: ReturnType<typeof createNonStreamingLogger>,
	result: GenerateResponse,
) {
	if (!logger.logCtx || !logger.requestLogger) {
		return;
	}

	await logger.requestLogger.captureEnd(logger.logCtx, {
		outputTokens: result.tokensUsed || 0,
		responseData: JSON.stringify(result),
	});
}

async function finalizeNonStreamingFailure(
	logger: ReturnType<typeof createNonStreamingLogger>,
	error: unknown,
) {
	if (!logger.logCtx || !logger.requestLogger) {
		return;
	}

	await logger.requestLogger.captureEnd(logger.logCtx, {
		error: error instanceof Error ? error : new Error(String(error)),
	});
}

function buildNonStreamingChatResponse(input: {
	result: GenerateResponse;
	createdAtSeconds: number;
	chatId: string;
}) {
	const { result, createdAtSeconds, chatId } = input;
	const canonicalResponse = createCanonicalResponse(
		chatId,
		result.model,
		result.text,
		{ prompt: 0, completion: result.tokensUsed ?? 0 },
	);

	return {
		...canonicalResponse,
		object: "chat.completion",
		created: createdAtSeconds,
		x_gateway: buildGatewayMetadata(result),
	};
}

function buildGatewayMetadata(result: GatewayMetadataInput) {
	return {
		requestedProvider: result.requestedProvider,
		requestedModel: result.requestedModel,
		resolvedProvider: result.resolvedProvider,
		resolvedModel: result.resolvedModel,
		fallbackUsed: result.fallbackUsed,
		tokensUsed: result.tokensUsed,
		routing: result.routing,
	};
}
