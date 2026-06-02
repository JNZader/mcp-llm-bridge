import type { Context } from "hono";

import { resolveRequestProject } from "./request-validation.js";

export interface RequestScope {
	project?: string;
	correlationId?: string;
}

export function getRequestCorrelationId(context: Context): string | undefined {
	const value = (context as { get: (key: string) => unknown }).get("correlationId");
	return typeof value === "string" ? value : undefined;
}

export function resolveRequestScope(
	context: Context,
	bodyProject?: string,
): RequestScope {
	return {
		project: resolveRequestProject(bodyProject, context),
		correlationId: getRequestCorrelationId(context),
	};
}
