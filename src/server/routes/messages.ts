import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { CostTracker } from "../../core/cost-tracker.js";
import type { Router } from "../../core/router.js";
import { TransformError } from "../../core/transformer.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import type { Vault } from "../../vault/vault.js";
import type { AnthropicSSEEvent } from "../execution/messages-service.js";
import {
	executeNonStreamingMessages,
	executeStreamingMessages,
	prepareMessagesRequest,
} from "../execution/messages-service.js";
import { resolveRequestScope, type RequestScope } from "../http-helpers/request-scope.js";

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
 * Handle a `stream: true` `/v1/messages` request with real Anthropic Messages
 * SSE framing.
 *
 * Drives `executeStreamingMessages` in two phases:
 *
 * 1. Pull the FIRST event out of the generator BEFORE opening the SSE
 *    response. If that first `.next()` call throws (provider resolution
 *    failed, or every candidate failed to open a connection), nothing has
 *    been written to the client yet, so we respond with a normal Anthropic-
 *    shaped JSON error — exactly like the non-streaming path.
 * 2. Once the first event (`message_start`) is in hand, commit to the SSE
 *    response via `streamSSE` and forward every subsequent event. Because
 *    `executeStreamingMessages` itself never throws past its first yield
 *    (it turns mid-stream failures into a yielded `error` event), the only
 *    reason `generator.next()` would throw here is a genuinely unexpected
 *    bug — handled defensively with one last `error` event before closing.
 */
async function handleStreamingMessages(
	c: Context,
	prepared: ReturnType<typeof prepareMessagesRequest>,
	router: Router,
	vault: Vault,
	requestLogger: RequestLogger | undefined,
	scope: RequestScope,
): Promise<Response> {
	const generator = executeStreamingMessages({ prepared, router, vault, scope, requestLogger });

	let first: IteratorResult<AnthropicSSEEvent>;
	try {
		first = await generator.next();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return jsonAnthropicError(c, 500, "api_error", message);
	}

	if (first.done) {
		return jsonAnthropicError(c, 500, "api_error", "Streaming produced no events");
	}

	const firstEvent = first.value;

	return streamSSE(c, async (stream) => {
		await stream.writeSSE({ event: firstEvent.event, data: JSON.stringify(firstEvent.data) });

		for (;;) {
			let next: IteratorResult<AnthropicSSEEvent>;
			try {
				next = await generator.next();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				try {
					await stream.writeSSE({
						event: "error",
						data: JSON.stringify({
							type: "error",
							error: { type: "api_error", message },
						}),
					});
				} catch {
					// Client may have already disconnected.
				}
				return;
			}

			if (next.done) return;
			await stream.writeSSE({ event: next.value.event, data: JSON.stringify(next.value.data) });
		}
	});
}

/**
 * Register `POST /v1/messages` — the Anthropic Messages API entry point.
 *
 * Supports both non-streaming responses and `stream: true` SSE responses
 * (3b-2), each built from the same provider-agnostic InternalLLMResponse /
 * InternalLLMChunk pipeline as the rest of the bridge.
 */
export function registerMessagesRoutes(app: Hono, deps: MessagesRouteDeps): void {
	const { router, vault, requestLogger } = deps;

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
		const scope = resolveRequestScope(c);

		let prepared: ReturnType<typeof prepareMessagesRequest>;
		try {
			prepared = prepareMessagesRequest(bodyRecord, scope);
		} catch (error) {
			if (error instanceof TransformError) {
				return jsonAnthropicError(c, 400, "invalid_request_error", error.message);
			}
			const message = error instanceof Error ? error.message : String(error);
			return jsonAnthropicError(c, 400, "invalid_request_error", message);
		}

		if (bodyRecord["stream"] === true) {
			return handleStreamingMessages(c, prepared, router, vault, requestLogger, scope);
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
