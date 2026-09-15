import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const ALLOWED_HEADERS = ["Content-Type", "Authorization", "X-Project", "x-api-key", "X-CSRF-Token"] as const;
const CORS_ORIGIN_ERROR = { error: "The request origin is not allowed.", code: "CSRF_ORIGIN_INVALID" } as const;

export function createCorsPolicy(allowedOrigins: readonly string[]): MiddlewareHandler {
	const allowed = new Set(allowedOrigins);
	const credentialCors = cors({
		origin: [...allowedOrigins],
		allowMethods: [...ALLOWED_METHODS],
		allowHeaders: [...ALLOWED_HEADERS],
		exposeHeaders: ["Content-Length"],
		maxAge: 86400,
		credentials: true,
	});

	return async (context, next) => {
		const origin = context.req.header("Origin");
		const originAllowed = origin !== undefined && allowed.has(origin);
		if (context.req.method === "OPTIONS" && !originAllowed) {
			return context.json(CORS_ORIGIN_ERROR, 403);
		}
		if (!originAllowed) {
			return next();
		}
		return credentialCors(context, next);
	};
}
