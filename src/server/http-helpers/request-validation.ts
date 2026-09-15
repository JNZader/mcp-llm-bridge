import type { Context } from "hono";
import { safeError, toSafeHttpError } from "../../core/safe-error.js";

const SAFE_VALIDATION_ERROR = toSafeHttpError(safeError("INVALID_REQUEST"));
const SAFE_VALIDATION_FIELD = {
	model: true,
	prompt: true,
	messages: true,
	"messages.0.role": true,
	"messages.0.content": true,
} as const;

function isSafeValidationField(field: string): boolean {
	return Object.prototype.hasOwnProperty.call(SAFE_VALIDATION_FIELD, field);
}

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
	if (!Array.isArray(issues)) {
		return undefined;
	}
	const firstIssue = issues[0];
	const path = firstIssue?.path;
	const field = Array.isArray(path) && path.every((part) => typeof part === "string" || typeof part === "number")
		? path.join(".")
		: "";

	return {
		message: SAFE_VALIDATION_ERROR.body.error,
		field: isSafeValidationField(field) ? field : "",
	};
}

export function jsonGenerateValidationError(
	c: Context,
	issue: ValidationIssue,
): Response {
	return c.json(
		{
			error: SAFE_VALIDATION_ERROR.body.error,
			code: "VALIDATION_ERROR",
			field: isSafeValidationField(issue.field) ? issue.field : "",
		},
		400,
	);
}

export function jsonChatInvalidRequestError(
	c: Context,
	_message: string,
	param: string | null | undefined,
): Response {
	return c.json(
		{
			error: {
				message: SAFE_VALIDATION_ERROR.body.error,
				type: "invalid_request_error",
				param: param && isSafeValidationField(param) ? param : undefined,
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
