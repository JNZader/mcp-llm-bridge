import type { Context } from "hono";

interface ZodIssueLike {
	message: string;
	path?: PropertyKey[];
}

interface ZodErrorLike {
	issues: ZodIssueLike[];
}

export interface ValidationIssue {
	message: string;
	field: string;
}

export function getValidationIssue(error: unknown): ValidationIssue | undefined {
	if (!error || typeof error !== "object" || !("issues" in error)) {
		return undefined;
	}

	const issues = (error as ZodErrorLike).issues;
	const firstIssue = issues[0];

	return {
		message: firstIssue?.message ?? "Validation error",
		field: firstIssue?.path?.join(".") ?? "",
	};
}

export function jsonGenerateValidationError(
	c: Context,
	issue: ValidationIssue,
): Response {
	return c.json(
		{
			error: issue.message,
			code: "VALIDATION_ERROR",
			field: issue.field,
		},
		400,
	);
}

export function jsonChatInvalidRequestError(
	c: Context,
	message: string,
	param: string | null | undefined,
): Response {
	return c.json(
		{
			error: {
				message,
				type: "invalid_request_error",
				param: param ?? undefined,
				code: null,
			},
		},
		400,
	);
}

export function jsonChatValidationError(
	c: Context,
	issue: ValidationIssue,
): Response {
	return jsonChatInvalidRequestError(c, issue.message, issue.field || undefined);
}

export function getHeaderProject(c: Context): string | undefined {
	return c.req.header("X-Project") ?? undefined;
}

export function resolveRequestProject(
	bodyProject: string | undefined,
	c: Context,
): string | undefined {
	return bodyProject ?? getHeaderProject(c);
}
