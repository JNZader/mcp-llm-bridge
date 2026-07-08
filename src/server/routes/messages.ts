import type { Context, Hono } from "hono";

import type { CostTracker } from "../../core/cost-tracker.js";
import type { Router } from "../../core/router.js";
import { TransformError } from "../../core/transformer.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import type { Vault } from "../../vault/vault.js";
import {
	executeNonStreamingMessages,
	prepareMessagesRequest,
} from "../execution/messages-service.js";
import { resolveRequestScope } from "../http-helpers/request-scope.js";

export interface MessagesRouteDeps {
	router: Router;
	vault: Vault;
	costTracker?: CostTracker;
	requestLogger?: RequestLogger;
}

/** Build an Anthropic-shaped error envelope: `{ type: "error", error: { type, message } }`. */
function jsonAnthropicError(
	c: Context,
	status: 400 | 500,
	errorType: string,
	message: string,
): Response {
	return c.json(
		{
			type: "error",
			error: { type: errorType, message },
		},
		status,
	);
}

/**
 * Register `POST /v1/messages` — the Anthropic Messages API entry point.
 *
 * Non-streaming only for now (3b-1). `stream: true` requests fail fast with
 * a clear 400 instead of silently falling back to a non-streaming body,
 * which would desync clients expecting SSE framing. SSE support is 3b-2.
 */
export function registerMessagesRoutes(app: Hono, deps: MessagesRouteDeps): void {
	const { router, requestLogger } = deps;

	app.post("/v1/messages", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return jsonAnthropicError(c, 400, "invalid_request_error", "Invalid JSON body");
		}

		if (typeof body !== "object" || body === null || Array.isArray(body)) {
			return jsonAnthropicError(
				c,
				400,
				"invalid_request_error",
				"Request body must be a JSON object",
			);
		}

		const bodyRecord = body as Record<string, unknown>;

		// TODO(3b-2): implement SSE streaming for /v1/messages.
		if (bodyRecord["stream"] === true) {
			return jsonAnthropicError(
				c,
				400,
				"invalid_request_error",
				"streaming not yet supported on /v1/messages — coming in 3b-2",
			);
		}

		let prepared: ReturnType<typeof prepareMessagesRequest>;
		try {
			const scope = resolveRequestScope(c);
			prepared = prepareMessagesRequest(bodyRecord, scope);
		} catch (error) {
			if (error instanceof TransformError) {
				return jsonAnthropicError(c, 400, "invalid_request_error", error.message);
			}
			const message = error instanceof Error ? error.message : String(error);
			return jsonAnthropicError(c, 400, "invalid_request_error", message);
		}

		try {
			const response = await executeNonStreamingMessages({
				prepared,
				router,
				requestLogger,
			});
			return c.json(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return jsonAnthropicError(c, 500, "api_error", message);
		}
	});
}
