import type { Context } from "hono";

import type { ChatCompletionsRequest } from "../../core/schemas.js";
import type { GenerateRequest } from "../../core/types.js";
import { optimizeMessages } from "../../transformers/three-part-prompt.js";
import type { CanonicalRequest } from "../../protocol-converter/types.js";

import { resolveRequestProject } from "./request-validation.js";

export const CHAT_COMPLETIONS_USER_MESSAGE_REQUIRED =
	"At least one user message is required";

export function buildChatGenerateRequest(
	canonicalRequest: CanonicalRequest | ChatCompletionsRequest,
	project?: string,
): GenerateRequest {
	const internalMessages = canonicalRequest.messages.map((message) => ({
		role: message.role,
		content: message.content,
	}));
	const optimizedMessages = optimizeMessages(internalMessages);

	const systemMessages = optimizedMessages
		.filter((message) => message.role === "system")
		.map((message) => (typeof message.content === "string" ? message.content : ""))
		.filter(Boolean);
	const system =
		systemMessages.length > 0 ? systemMessages.join("\n") : undefined;

	const conversationMessages = optimizedMessages.filter(
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
		...(typeof canonicalRequest["provider"] === "string"
			? { provider: canonicalRequest["provider"] }
			: {}),
		...(canonicalRequest["strict"] === true ? { strict: true } : {}),
		project,
	};
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
