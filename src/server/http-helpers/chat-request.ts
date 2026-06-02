import type { InternalLLMRequest } from "../../core/internal-model.js";
import type { ChatCompletionsRequest } from "../../core/schemas.js";
import type { GenerateRequest } from "../../core/types.js";
import { optimizeMessages } from "../../transformers/three-part-prompt.js";
import type {
	CanonicalMessage,
	CanonicalRequest,
} from "../../protocol-converter/types.js";
import type { RequestScope } from "./request-scope.js";

export const CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED =
	"At least one user message is required";

export type ChatGenerateMessage = Pick<CanonicalMessage, "role" | "content">;

export function assertChatMessagesContainUserMessage(
	messages: readonly ChatGenerateMessage[],
): void {
	const hasUserMessage = messages.some((message) => message.role === "user");

	if (!hasUserMessage) {
		throw new Error(CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED);
	}
}

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

export function buildChatInternalMetadata(
	request: CanonicalRequest | ChatCompletionsRequest,
	scope?: RequestScope,
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

	if (scope?.project) {
		metadata["project"] = scope.project;
	}

	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function buildChatGenerateRequestFromMessages(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	messages: readonly ChatGenerateMessage[],
	scope?: RequestScope,
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
	assertChatMessagesContainUserMessage(conversationMessages);
	const lastUserMessage = [...conversationMessages]
		.reverse()
		.find((message) => message.role === "user")!;

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
		project: scope?.project,
	};
}

export function buildChatInternalRequestFromMessages(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	messages: readonly ChatGenerateMessage[],
	scope?: RequestScope,
): InternalLLMRequest {
	assertChatMessagesContainUserMessage(messages);

	return {
		messages: messages.map((message) => ({
			role: message.role,
			content: message.content,
		})),
		model: canonicalRequest.model,
		maxTokens: canonicalRequest.max_tokens,
		metadata: buildChatInternalMetadata(canonicalRequest, scope),
	};
}

export function buildChatGenerateRequest(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	scope?: RequestScope,
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
		scope,
	);
}

export function prepareChatGenerateRequest(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	scope: RequestScope,
): GenerateRequest {
	return buildChatGenerateRequest(canonicalRequest, scope);
}
