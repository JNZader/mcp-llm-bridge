import type { Context } from "hono";

import type { InternalLLMRequest } from "../../core/internal-model.js";
import type { ChatCompletionsRequest } from "../../core/schemas.js";
import type { GenerateRequest } from "../../core/types.js";
import { optimizeMessages } from "../../transformers/three-part-prompt.js";
import type {
	CanonicalMessage,
	CanonicalRequest,
} from "../../protocol-converter/types.js";

import { resolveRequestProject } from "./request-validation.js";

export const CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED =
	"At least one user message is required";

export type ChatGenerateMessage = Pick<CanonicalMessage, "role" | "content">;

function normalizeChatGenerateMessages(
	messages: ReadonlyArray<{ role: string; content?: unknown }>,
): ChatGenerateMessage[] {
	return messages
		.filter(
			(message): message is { role: ChatGenerateMessage["role"]; content?: unknown } =>
				message.role === "system" ||
				message.role === "user" ||
				message.role === "assistant",
		)
		.map((message) => ({
			role: message.role,
			content: typeof message.content === "string" ? message.content : "",
		}));
}

function getOptionalCanonicalString(
	request: CanonicalRequest | ChatCompletionsRequest,
	key: string,
): string | undefined {
	if (!(key in request)) return undefined;
	const value = (request as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

function getOptionalCanonicalBoolean(
	request: CanonicalRequest | ChatCompletionsRequest,
	key: string,
): boolean {
	if (!(key in request)) return false;
	const value = (request as Record<string, unknown>)[key];
	return value === true;
}

function buildChatInternalMetadata(
	request: CanonicalRequest | ChatCompletionsRequest,
	project?: string,
): Record<string, unknown> | undefined {
	const metadata: Record<string, unknown> = {};
	const provider = getOptionalCanonicalString(request, "provider");

	if (provider) {
		metadata["provider"] = provider;
	}

	const clientId = getOptionalCanonicalString(request, "clientId");
	if (clientId) {
		metadata["clientId"] = clientId;
	}

	if (getOptionalCanonicalBoolean(request, "strict")) {
		metadata["strict"] = true;
	}

	if (project) {
		metadata["project"] = project;
	}

	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function buildChatGenerateRequestFromMessages(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	messages: readonly ChatGenerateMessage[],
	project?: string,
): GenerateRequest {
	const systemMessages = messages
		.filter((message) => message.role === "system")
		.map((message) => (typeof message.content === "string" ? message.content : ""))
		.filter(Boolean);
	const system =
		systemMessages.length > 0 ? systemMessages.join("\n") : undefined;

	const conversationMessages = messages.filter(
		(message) => message.role !== "system",
	);
	const lastUserMessage = [...conversationMessages]
		.reverse()
		.find((message) => message.role === "user");

	if (!lastUserMessage) {
		throw new Error(CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED);
	}

	const earlierMessages = conversationMessages.slice(0, -1);
	let prompt =
		typeof lastUserMessage.content === "string" ? lastUserMessage.content : "";
	if (earlierMessages.length > 0) {
		const context = earlierMessages
			.map(
				(message) =>
					`${message.role}: ${typeof message.content === "string" ? message.content : ""}`,
			)
			.join("\n");
		prompt = `${context}\nuser: ${prompt}`;
	}

	return {
		prompt,
		system,
		model: canonicalRequest.model,
		maxTokens: canonicalRequest.max_tokens,
		...(typeof getOptionalCanonicalString(canonicalRequest, "provider") === "string"
			? { provider: getOptionalCanonicalString(canonicalRequest, "provider") }
			: {}),
		...(getOptionalCanonicalBoolean(canonicalRequest, "strict")
			? { strict: true }
			: {}),
		project,
	};
}

export function buildChatInternalRequestFromMessages(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	messages: readonly ChatGenerateMessage[],
	project?: string,
): InternalLLMRequest {
	const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");

	if (!lastUserMessage) {
		throw new Error(CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED);
	}

	return {
		messages: messages.map((message) => ({
			role: message.role,
			content: message.content,
		})),
		model: canonicalRequest.model,
		maxTokens: canonicalRequest.max_tokens,
		metadata: buildChatInternalMetadata(canonicalRequest, project),
	};
}

export function buildChatGenerateRequest(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	project?: string,
): GenerateRequest {
	const internalMessages = canonicalRequest.messages.map((message) => ({
		role: message.role,
		content: message.content,
	}));
	const optimizedMessages = normalizeChatGenerateMessages(
		optimizeMessages(internalMessages),
	);

	return buildChatGenerateRequestFromMessages(
		canonicalRequest,
		optimizedMessages,
		project,
	);
}

export function prepareChatGenerateRequest(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	c: Context,
): GenerateRequest {
	return buildChatGenerateRequest(
		canonicalRequest,
		resolveRequestProject(undefined, c),
	);
}
