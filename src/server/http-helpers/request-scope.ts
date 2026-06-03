import type { Context } from "hono";

import type { UserContext } from "../../auth/types.js";

import { resolveRequestProject } from "./request-validation.js";

export interface RequestScope {
	project?: string;
	correlationId?: string;
	apiKeyId?: string;
	userId?: string;
}

export function getRequestCorrelationId(context: Context): string | undefined {
	const value = (context as { get: (key: string) => unknown }).get("correlationId");
	return typeof value === "string" ? value : undefined;
}

export function resolveRequestScope(
	context: Context,
	bodyProject?: string,
): RequestScope {
	const userContext = getRequestUserContext(context);

	return {
		project: resolveRequestProject(bodyProject, context),
		correlationId: getRequestCorrelationId(context),
		apiKeyId: userContext?.apiKeyId,
		userId: userContext?.userId,
	};
}

function getRequestUserContext(context: Context): UserContext | undefined {
	const value = (context as { get: (key: string) => unknown }).get("userContext");

	if (!value || typeof value !== "object") {
		return undefined;
	}

	const maybeUserContext = value as Partial<UserContext>;
	if (
		typeof maybeUserContext.apiKeyId !== "string" ||
		typeof maybeUserContext.userId !== "string"
	) {
		return undefined;
	}

	return maybeUserContext as UserContext;
}
