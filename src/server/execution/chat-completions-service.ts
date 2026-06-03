import { randomUUID } from "node:crypto";

import type { ChatCompletionsRequest } from "../../core/schemas.js";
import type { Router } from "../../core/router.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import {
	createOpenAIUsage,
	normalizeOpenAIRequest,
} from "../../protocol-converter/index.js";
import type { CanonicalRequest } from "../../protocol-converter/types.js";
import { optimizeMessages } from "../../transformers/three-part-prompt.js";
import {
	assertChatMessagesContainUserMessage,
	type ChatGenerateMessage,
	buildChatInternalRequestFromMessages,
} from "../http-helpers/chat-request.js";
import type { RequestScope } from "../http-helpers/request-scope.js";

interface GatewayMetadataInput {
	requestedProvider?: string;
	requestedModel?: string;
	resolvedProvider?: string;
	resolvedModel?: string;
	fallbackUsed?: boolean;
	tokensUsed?: number;
	inputTokens?: number;
	outputTokens?: number;
	routing?: { attemptedProviders?: string[] } & Record<string, unknown>;
}

interface NonStreamingChatResult extends GatewayMetadataInput {
	text: string;
	provider: string;
	model: string;
	resolvedProvider: string;
	resolvedModel: string;
}

function resolveAttemptsFromRouting(result: {
	routing?: { attemptedProviders?: string[] };
}): number {
	return result.routing?.attemptedProviders?.length ?? 1;
}

interface NonStreamingChatLogger {
	requestLogger?: RequestLogger;
	startTimeMs: number;
	requestedModel?: string;
	correlationId?: string;
}

export interface PreparedChatCompletionsRequest {
	canonicalRequest: CanonicalRequest;
	optimizedCanonicalRequest: CanonicalRequest;
}

export interface ExecuteNonStreamingChatCompletionsInput {
	prepared: PreparedChatCompletionsRequest;
	router: Router;
	scope: RequestScope;
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
	assertChatMessagesContainUserMessage(normalizedOptimizedMessages);

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
		scope,
		requestLogger,
		now = Date.now,
		createChatCompletionId = () => `chatcmpl-${randomUUID()}`,
	} = input;
	const logger = createNonStreamingLogger({
		requestLogger,
		startTimeMs: now(),
		requestedModel: prepared.canonicalRequest.model,
		correlationId: scope.correlationId,
	});

	try {
		const result = mapInternalResultToNonStreamingChatResult(
			await router.generateFromInternal(
				buildChatInternalRequestFromMessages(
					prepared.canonicalRequest,
					prepared.optimizedCanonicalRequest.messages,
					scope,
				),
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
	const { requestLogger, startTimeMs, requestedModel, correlationId } = input;
	return {
		requestLogger,
		logCtx: requestLogger?.captureStart({
			provider: "unknown",
			model: requestedModel || "unknown",
			correlationId,
			startTime: startTimeMs,
		}),
	};
}

async function finalizeNonStreamingSuccess(
	logger: ReturnType<typeof createNonStreamingLogger>,
	result: NonStreamingChatResult,
) {
	if (!logger.logCtx || !logger.requestLogger) {
		return;
	}

	await logger.requestLogger.captureEnd(logger.logCtx, {
		provider: result.resolvedProvider,
		model: result.resolvedModel,
		totalTokens: result.tokensUsed,
		inputTokens: result.inputTokens,
		outputTokens: result.outputTokens,
		attempts: resolveAttemptsFromRouting(result),
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
		attempts: 1,
		error: error instanceof Error ? error : new Error(String(error)),
	});
}

function buildNonStreamingChatResponse(input: {
	result: NonStreamingChatResult;
	createdAtSeconds: number;
	chatId: string;
}) {
	const { result, createdAtSeconds, chatId } = input;
	const usage =
		typeof result.inputTokens === "number" && typeof result.outputTokens === "number"
			? createOpenAIUsage({
				promptTokens: result.inputTokens,
				completionTokens: result.outputTokens,
			})
			: createOpenAIUsage({
				totalTokens: result.tokensUsed,
			});
	const response = {
		id: chatId,
		model: result.model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: result.text,
				},
				finish_reason: "stop",
			},
		],
		object: "chat.completion",
		created: createdAtSeconds,
		x_gateway: buildGatewayMetadata(result),
	};

	return usage ? { ...response, usage } : response;
}

function mapInternalResultToNonStreamingChatResult(
	result: {
		content: string;
		model: string;
		usage: {
			inputTokens?: number;
			outputTokens?: number;
			totalTokens?: number;
		};
		metadata?: Record<string, unknown>;
	},
): NonStreamingChatResult {
	const metadata = result.metadata ?? {};
	const provider = readMetadataString(metadata, "provider") ?? "unknown";
	const resolvedProvider =
		readMetadataString(metadata, "resolvedProvider") ?? provider;
	const resolvedModel =
		readMetadataString(metadata, "resolvedModel") ?? result.model;

	return {
		text: result.content,
		provider,
		model: result.model,
		tokensUsed: result.usage.totalTokens,
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		requestedProvider: readMetadataString(metadata, "requestedProvider"),
		requestedModel: readMetadataString(metadata, "requestedModel"),
		resolvedProvider,
		resolvedModel,
		fallbackUsed: metadata["fallbackUsed"] === true,
		routing: readRoutingMetadata(metadata["routing"]),
	};
}

function readMetadataString(
	metadata: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = metadata[key];
	return typeof value === "string" ? value : undefined;
}

function readRoutingMetadata(
	value: unknown,
): ({ attemptedProviders?: string[] } & Record<string, unknown>) | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	return value as { attemptedProviders?: string[] } & Record<string, unknown>;
}

function buildGatewayMetadata(result: GatewayMetadataInput) {
	return {
		requestedProvider: result.requestedProvider,
		requestedModel: result.requestedModel,
		resolvedProvider: result.resolvedProvider,
		resolvedModel: result.resolvedModel,
		fallbackUsed: result.fallbackUsed,
		tokensUsed: result.tokensUsed,
		inputTokens: result.inputTokens,
		outputTokens: result.outputTokens,
		routing: result.routing,
	};
}
