/**
 * HTTP Server — Hono-based REST API for the LLM Gateway.
 *
 * Provides HTTP endpoints for LLM generation, model listing,
 * provider status, and credential management.
 *
 * Supports per-project scoping via `project` body field or `X-Project` header.
 */

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { type ServerType, serve } from "@hono/node-server";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

/** Request timeout in milliseconds (2 minutes). */
const REQUEST_TIMEOUT_MS = 120_000;

/** Header name for request correlation ID. */
export const CORRELATION_ID_HEADER = "X-Correlation-ID";

import type Database from "better-sqlite3";
import { apiKeyAuth } from "../auth/middleware.js";
import type { ComparisonService } from "../comparison/service.js";
import { getCircuitBreakerRegistry } from "../core/circuit-breaker.js";
import { getCircuitBreakerV2 } from "../core/router.js";
import { MAX_BODY_SIZE, VALID_PROVIDERS, VERSION } from "../core/constants.js";
import type { CostTracker } from "../core/cost-tracker.js";
import type { GroupStore } from "../core/groups.js";
import { CreateGroupSchema, UpdateGroupSchema } from "../core/groups.js";
import type { InternalLLMRequest } from "../core/internal-model.js";
import { logger } from "../core/logger.js";
import { estimateCost, getPriceTable } from "../core/pricing.js";
import type { Router } from "../core/router.js";
import {
	costEstimateQuerySchema,
	validateChatCompletions,
	validateCredentialStore,
	validateFileStore,
	validateGenerateRequest,
} from "../core/schemas.js";
import type { GatewayConfig, TrustLevel } from "../core/types.js";
import type { ApprovalStore } from "../approval/index.js";
import type { FreeModelRouter } from "../free-models/router.js";
import type { LatencyMeasurer } from "../latency/index.js";
import type { Vault } from "../vault/vault.js";
import type { AnalyticsAggregator } from "../analytics/index.js";
import type { SessionManager } from "../session/session-manager.js";
import type { RequestLogger } from "../logging/request-logger.js";
import type { LogContext } from "../logging/types.js";
import { registerAdminRoutes } from "./admin.js";
import { dashboardHtml } from "./dashboard.js";
import { RateLimiter } from "./rate-limit.js";
import { securityProfileMiddleware } from "../security/enforcer.js";
import { optimizeMessages } from "../transformers/three-part-prompt.js";
import {
  normalizeOpenAIRequest,
  createCanonicalResponse,
} from "../protocol-converter/index.js";
import {
	isGithubOauthConfigured,
	getGithubAuthUrl,
	exchangeCodeForUser,
	createDashboardJwt,
	isUserAllowed,
} from "../auth/github-oauth.js";
import { registerObservabilityRoutes } from "./routes/observability.js";
import { registerComparisonRoutes } from "./routes/comparison.js";
import { registerToolingRoutes } from "./routes/tooling.js";

export interface StartHttpServerDeps {
	router: Router;
	vault: Vault;
	config: GatewayConfig;
	groupStore?: GroupStore;
	costTracker?: CostTracker;
	latencyMeasurer?: LatencyMeasurer;
	freeModelRouter?: FreeModelRouter;
	db?: Database.Database;
	analyticsAggregator?: AnalyticsAggregator;
	comparisonService?: ComparisonService;
	securityProfile?: TrustLevel;
	approvalStore?: ApprovalStore;
	sessionManager?: SessionManager;
	requestLogger?: RequestLogger;
}

function isStartHttpServerDeps(
	input: Router | StartHttpServerDeps,
): input is StartHttpServerDeps {
	return (
		typeof input === "object" &&
		input !== null &&
		"router" in input &&
		"vault" in input &&
		"config" in input
	);
}

/**
 * Timing-safe comparison for bearer tokens.
 * Returns true if both tokens are equal, using constant-time comparison
 * to prevent timing attacks.
 */
function tokenEquals(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * Bearer token auth middleware.
 *
 * - If `config.authToken` is not set → all requests pass (auth disabled).
 * - Skips `GET /health` (Coolify health checks) and `OPTIONS *` (CORS preflight).
 * - All other routes including the dashboard require `Authorization: Bearer <token>`.
 */
function bearerAuth(config: GatewayConfig) {
	return async (c: Context, next: Next) => {
		// No token configured → auth disabled (local dev)
		if (!config.authToken) {
			return next();
		}

		// Always allow health checks (Coolify, uptime monitors)
		if (c.req.method === "GET" && c.req.path === "/health") {
			return next();
		}

		// Skip GitHub OAuth routes and auth config (public endpoints)
		if (c.req.path.startsWith("/auth/github")) {
			return next();
		}
		if (c.req.path === "/v1/admin/auth-config") {
			return next();
		}

		// Skip admin routes — they have their own auth middleware
		if (c.req.path.startsWith("/v1/admin/")) {
			return next();
		}

		// CORS preflight must pass through (handled by cors middleware)
		if (c.req.method === "OPTIONS") {
			return next();
		}

		// Check Authorization header
		const authHeader = c.req.header("Authorization");
		if (!authHeader) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const parts = authHeader.split(" ");
		if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		if (!tokenEquals(parts[1], config.authToken)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		return next();
	};
}

/**
 * Extract project from request: body field takes priority, then X-Project header.
 */
function resolveProject(
	bodyProject: string | undefined,
	headerProject: string | undefined,
): string | undefined {
	return bodyProject ?? headerProject ?? undefined;
}

function buildGatewayMetadata(result: {
	requestedProvider?: string;
	requestedModel?: string;
	resolvedProvider?: string;
	resolvedModel?: string;
	fallbackUsed?: boolean;
	tokensUsed?: number;
}) {
	return {
		requestedProvider: result.requestedProvider,
		requestedModel: result.requestedModel,
		resolvedProvider: result.resolvedProvider,
		resolvedModel: result.resolvedModel,
		fallbackUsed: result.fallbackUsed,
		tokensUsed: result.tokensUsed,
	};
}

/**
 * Extract allowed CORS origins from environment variable.
 *
 * Format: comma-separated list of origins, or '*' for allow all.
 * Example: 'https://example.com,https://app.example.com'
 */
function getCorsOrigins(): string | string[] {
	const envOrigins = process.env["LLM_GATEWAY_CORS_ORIGINS"];
	if (!envOrigins) {
		// Default: allow only Cloudflare hosted dashboard
		return ["https://gateway.javierzader.com"];
	}
	if (envOrigins === "*") {
		// CORS '*' is allowed but we return it as-is
		return "*";
	}
	return envOrigins.split(",").map((o) => o.trim());
}

/**
 * Request body size limit middleware.
 * Rejects requests with bodies larger than MAX_BODY_SIZE.
 */
async function bodySizeLimit(c: Context, next: Next): Promise<Response | void> {
	const contentLength = c.req.header("content-length");
	if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
		return c.json(
			{ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" },
			413,
		);
	}
	await next();
}

/**
 * Get the client IP address from the request.
 *
 * Security: Only trusts X-Forwarded-For if TRUSTED_PROXY_IPS env var is set
 * and the direct connection comes from a trusted proxy. Otherwise, falls
 * back to direct connection IP to prevent IP spoofing attacks.
 */
function getClientIp(c: Context): string {
	const trustedProxies = process.env["TRUSTED_PROXY_IPS"];

	// If no trusted proxies configured, don't trust forwarded headers
	if (!trustedProxies) {
		return c.req.header("x-real-ip") ?? "unknown";
	}

	const trustedSet = new Set(trustedProxies.split(",").map((ip) => ip.trim()));

	// Get the direct connection IP
	const directIp = c.req.header("x-real-ip") ?? "unknown";

	// Only trust X-Forwarded-For if direct connection is from trusted proxy
	if (trustedSet.has(directIp)) {
		const forwarded = c.req.header("x-forwarded-for");
		if (forwarded) {
			const firstIp = forwarded.split(",")[0];
			return firstIp?.trim() ?? directIp;
		}
	}

	// Return direct IP (either not from trusted proxy, or no forwarded header)
	return directIp;
}

/**
 * Request timeout middleware.
 * Aborts requests that take too long.
 */
async function requestTimeout(
	c: Context,
	next: Next,
): Promise<Response | void> {
	let timedOut = false;

	const timeoutId = setTimeout(() => {
		timedOut = true;
	}, REQUEST_TIMEOUT_MS);

	try {
		await next();
	} finally {
		clearTimeout(timeoutId);
	}

	if (timedOut) {
		return c.json({ error: "Request timeout", code: "REQUEST_TIMEOUT" }, 408);
	}
}

/**
 * Correlation ID middleware.
 * Generates or extracts a correlation ID for request tracing.
 * The correlation ID is added to the response headers and available in context.
 */
async function correlationId(c: Context, next: Next): Promise<void> {
	// Use existing correlation ID from header or generate new one
	const existingId = c.req.header(CORRELATION_ID_HEADER);
	const correlationId = existingId ?? randomUUID();

	// Store in context variables for access in handlers
	c.set("correlationId", correlationId);

	// Add to response headers
	c.header(CORRELATION_ID_HEADER, correlationId);

	await next();
}

/**
 * Rate limit middleware factory.
 * Creates a middleware that rate limits requests per IP.
 */
function rateLimitMiddleware(limiter: RateLimiter) {
	return async (c: Context, next: Next): Promise<void> => {
		// Skip rate limiting for health checks
		if (c.req.method === "GET" && c.req.path === "/health") {
			return next();
		}

		const ip = getClientIp(c);

		if (limiter.isRateLimited(ip)) {
			const resetAt = limiter.getResetAt(ip);
			const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
			c.header("Retry-After", String(retryAfter));
			c.header("X-RateLimit-Remaining", "0");
			c.header("X-RateLimit-Reset", String(Math.floor(resetAt / 1000)));
			c.status(429);
			c.json({
				error: "Too many requests",
				code: "RATE_LIMITED",
				retryAfter,
			});
			return;
		}

		// Add rate limit headers to response
		c.header("X-RateLimit-Remaining", String(limiter.getRemaining(ip)));
		c.header(
			"X-RateLimit-Reset",
			String(Math.floor(limiter.getResetAt(ip) / 1000)),
		);

		await next();
	};
}

/** Server start time for uptime calculation. */
let serverStartTime: number = Date.now();

/**
 * Detect Anthropic subscription tier from stored credentials.
 *
 * @param vault - The credential vault
 * @returns Subscription tier: "pro", "max", "api", or "none"
 */
function detectAnthropicSubscription(
	vault: Vault,
): "pro" | "max" | "api" | "none" {
	try {
		// Try to get the decrypted API key to check its format
		const apiKey = vault.getDecrypted("anthropic", "default");

		// Check key prefix patterns for tier detection
		if (apiKey.startsWith("sk-ant-")) {
			// Standard Anthropic API key
			return "api";
		}

		// Default to API for any other key format
		return "api";
	} catch {
		// No credential found
		return "none";
	}
}

/** Provider-specific base URLs for OpenAI-compatible streaming. */
const PROVIDER_BASE_URLS: Record<string, string> = {
	google: "https://generativelanguage.googleapis.com/v1beta/openai/",
	groq: "https://api.groq.com/openai/v1",
	openrouter: "https://openrouter.ai/api/v1",
};

/**
 * Handle a streaming chat completion request via SSE.
 *
 * Resolves the best provider with a streaming transformer, opens an SSE
 * stream, and forwards transformed chunks in OpenAI-compatible SSE format.
 * Records cost after the stream completes.
 */
function handleStreamingRequest(
	c: Context,
	canonical: import("../protocol-converter/types.js").CanonicalRequest,
	router: Router,
	costTracker?: CostTracker,
	vault?: Vault,
	requestLogger?: RequestLogger,
): Response {
	const chatId = `chatcmpl-${randomUUID()}`;
	const model = canonical.model ?? "";
	const project = c.req.header("X-Project") ?? undefined;

	// Build InternalLLMRequest from canonical body
	const internalMessages = canonical.messages.map((m) => ({
		role: m.role as "system" | "user" | "assistant",
		content: m.content,
	}));

	const internalRequest: InternalLLMRequest = {
		messages: internalMessages,
		model: canonical.model,
		maxTokens: canonical.max_tokens,
	};

	return streamSSE(c, async (stream) => {
		const logCtx = requestLogger?.captureStart({
			provider: "unknown",
			model: canonical.model || "unknown",
			startTime: Date.now(),
		});
		let logCompleted = false;
		let inputTokens: number | undefined;
		let outputTokens: number | undefined;

		const finalizeRequestLog = async (input: {
			inputTokens?: number;
			outputTokens?: number;
			error?: Error;
			requestData?: unknown;
			responseData?: unknown;
		} = {}) => {
			if (!requestLogger || !logCtx || logCompleted) {
				return;
			}

			logCompleted = true;
			await requestLogger.captureEnd(logCtx, {
				inputTokens: input.inputTokens,
				outputTokens: input.outputTokens,
				error: input.error,
				requestData: input.requestData,
				responseData: input.responseData,
			});
		};

		const abortHandler = () => {
			void finalizeRequestLog({
				inputTokens,
				outputTokens,
				error: new Error("Stream aborted by client"),
			});
		};

		c.req.raw.signal.addEventListener("abort", abortHandler, { once: true });

		try {
			const resolved = await router.resolveStreamingProvider(internalRequest);

			if (!resolved) {
				// No streaming transformer - fallback: run non-streaming and send as single SSE event
				let result;
				try {
					result = await router.generate({
						prompt: canonical.messages
							.filter((m) => m.role !== "system")
							.map((m) => m.content)
							.join("\n"),
						system:
							canonical.messages
								.filter((m) => m.role === "system")
								.map((m) => m.content)
								.join("\n") || undefined,
						model: canonical.model,
						maxTokens: canonical.max_tokens,
						project,
					});
				} catch (error) {
					await finalizeRequestLog({
						error: error instanceof Error ? error : new Error(String(error)),
					});
					throw error;
				}

				outputTokens = result.tokensUsed || 0;
				await finalizeRequestLog({
					outputTokens,
					responseData: result,
				});

				// Build canonical response via protocol-converter, then reshape to SSE chunk
				const canonicalResponse = createCanonicalResponse(
					chatId,
					result.model,
					result.text,
					{ prompt: 0, completion: result.tokensUsed ?? 0 },
				);

				await stream.writeSSE({
					data: JSON.stringify({
						...canonicalResponse,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						choices: [
							{
								index: 0,
								delta: { content: result.text },
								finish_reason: "stop",
							},
						],
					}),
				});

				await stream.writeSSE({ data: "[DONE]" });
				return;
			}

			const { provider, request: resolvedRequest, streamTransformer } = resolved;
			if (logCtx) {
				logCtx.provider = provider.id;
				logCtx.model = resolvedRequest.model || model || "unknown";
			}
			const streamRecorder = costTracker?.recordStream(
				provider.id,
				resolvedRequest.model || model || "unknown",
				project,
			);

			try {
				// Build providerCall using the vault for credentials
				const providerCall = buildProviderStreamCall(provider.id, vault, project);
				const chunks = streamTransformer.transformStream(
					resolvedRequest,
					providerCall,
				);

				for await (const chunk of chunks) {
					streamRecorder?.addChunk(
						{ tokensIn: chunk.tokensIn, tokensOut: chunk.tokensOut },
						chunk.content.length,
					);

					if (chunk.tokensIn !== undefined) {
						inputTokens = chunk.tokensIn;
					}
					if (chunk.tokensOut !== undefined) {
						outputTokens = chunk.tokensOut;
					}
					if (chunk.model && logCtx) {
						logCtx.model = chunk.model;
					}

					await stream.writeSSE({
						data: JSON.stringify({
							id: chatId,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: chunk.model || model,
							choices: [
								{
									index: 0,
									delta: chunk.content ? { content: chunk.content } : {},
									finish_reason: chunk.done
										? (chunk.finishReason ?? "stop")
										: null,
								},
							],
							...(chunk.done &&
							(chunk.tokensIn !== undefined || chunk.tokensOut !== undefined)
								? {
										usage: {
											prompt_tokens: chunk.tokensIn ?? 0,
											completion_tokens: chunk.tokensOut ?? 0,
											total_tokens:
												(chunk.tokensIn ?? 0) + (chunk.tokensOut ?? 0),
										},
									}
								: {}),
						}),
					});
				}

				await stream.writeSSE({ data: "[DONE]" });
				getCircuitBreakerV2().recordSuccess(provider.id, 'default', model);
				streamRecorder?.finish();
				await finalizeRequestLog({
					inputTokens,
					outputTokens,
					responseData: {
						stream: true,
						provider: provider.id,
						model: logCtx?.model,
					},
				});
			} catch (error) {
				getCircuitBreakerV2().recordFailure(provider.id, 'default', model);
				const message = error instanceof Error ? error.message : String(error);
				streamRecorder?.finish(message);
				await finalizeRequestLog({
					inputTokens,
					outputTokens,
					error: error instanceof Error ? error : new Error(String(error)),
				});

				try {
					await stream.writeSSE({
						data: JSON.stringify({
							error: { message, type: "server_error", code: null },
						}),
					});
					await stream.writeSSE({ data: "[DONE]" });
				} catch {
					// Stream may already be closed
				}
			}
		} finally {
			c.req.raw.signal.removeEventListener("abort", abortHandler);
		}
	});
}

/**
 * Build a providerCall function that creates a streaming SDK call
 * using credentials from the Vault.
 */
function buildProviderStreamCall(
	providerId: string,
	vault?: Vault,
	project?: string,
): (request: unknown) => AsyncIterable<unknown> {
	return async function* streamCall(request: unknown): AsyncIterable<unknown> {
		const body = request as Record<string, unknown>;

		if (providerId === "anthropic") {
			const Anthropic = (await import("@anthropic-ai/sdk")).default;
			let client: InstanceType<typeof Anthropic>;

			// Try OAuth first, then API key
			if (vault) {
				const oauthToken = await vault.getClaudeOAuthToken(project);
				if (oauthToken?.accessToken) {
					client = new Anthropic({ authToken: oauthToken.accessToken });
				} else {
					const apiKey = vault.getDecrypted("anthropic", "default", project);
					client = new Anthropic({ apiKey });
				}
			} else {
				client = new Anthropic();
			}

			const { stream: _stream, ...restBody } = body;

			// Use Anthropic SDK's streaming API
			const messageStream = client.messages.stream(
				restBody as unknown as Parameters<typeof client.messages.stream>[0],
			);
			for await (const event of messageStream) {
				yield event;
			}
		} else {
			// OpenAI-compatible providers
			const OpenAI = (await import("openai")).default;
			let apiKey = "";

			if (vault) {
				try {
					apiKey = vault.getDecrypted(providerId, "default", project);
				} catch {
					// Vault may not have credentials for this provider
				}
			}

			const baseURL = PROVIDER_BASE_URLS[providerId];
			const client = new OpenAI({
				apiKey,
				...(baseURL ? { baseURL } : {}),
			});

			const { stream: _stream, stream_options: _so, ...restBody } = body;

			const streamResponse = await client.chat.completions.create({
				...(restBody as unknown as Parameters<
					typeof client.chat.completions.create
				>[0]),
				stream: true,
				stream_options: { include_usage: true },
			});

			for await (const chunk of streamResponse) {
				yield chunk;
			}
		}
	};
}

/**
 * Start the HTTP server on the configured port.
 *
 * All endpoints share the same Router and Vault instances
 * as the MCP server.
 *
 * @returns The HTTP server instance
 */
export function startHttpServerWithDeps(deps: StartHttpServerDeps): ServerType {
	const {
		router,
		vault,
		config,
		groupStore,
		costTracker,
		latencyMeasurer,
		freeModelRouter,
		db,
		analyticsAggregator,
		comparisonService,
		securityProfile,
		approvalStore,
		sessionManager,
		requestLogger,
	} = deps;

	// Reset start time on server creation
	serverStartTime = Date.now();

	const app = new Hono();

	// ── Rate limiter — 100 requests per 15 minutes per IP ──
	const rateLimiter = new RateLimiter();

	// ── Security middleware ────────────────────────────────

	// HTTP compression
	app.use(compress());

	// Request timeout
	app.use(requestTimeout);

	// Correlation ID for request tracing
	app.use(correlationId);

	// Rate limiting
	app.use("*", rateLimitMiddleware(rateLimiter));

	// Body size limit
	app.use("*", bodySizeLimit);

	// ── CORS — configurable via LLM_GATEWAY_CORS_ORIGINS ──
	const corsOrigins = getCorsOrigins();
	app.use(
		"*",
		cors({
			origin: corsOrigins === "*" ? "*" : corsOrigins,
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "X-Project"],
			exposeHeaders: ["Content-Length"],
			maxAge: 86400,
		}),
	);

	// ── Auth — bearer token middleware ─────────────────────
	//
	// When ENABLE_MULTI_TENANT=true, /v1/* routes (except /v1/admin/* and health)
	// use per-key auth via apiKeyAuth middleware. The existing bearerAuth still
	// runs for non-v1 routes (dashboard, metrics, etc.) and as a fallback.
	//
	const multiTenantEnabled =
		process.env["ENABLE_MULTI_TENANT"] === "true" && db;

	if (multiTenantEnabled) {
		// Multi-tenant mode: API key auth for /v1/* routes (except admin — has its own auth)
		app.use("/v1/*", async (c: Context, next: Next) => {
			// Skip admin routes — they have their own auth middleware
			if (c.req.path.startsWith("/v1/admin/")) {
				return next();
			}
			// Delegate to API key auth middleware
			return apiKeyAuth(db, costTracker)(c, next);
		});

		// Non-v1 routes still use bearer auth (dashboard, health, metrics)
		app.use("*", async (c: Context, next: Next) => {
			if (c.req.path.startsWith("/v1/")) {
				return next(); // Already handled above
			}
			return bearerAuth(config)(c, next);
		});
	} else {
		// Single-tenant mode: existing AUTH_TOKEN flow for all routes
		app.use("*", bearerAuth(config));
	}

	// ── Security Profile Enforcement ───────────────────────
	//
	// Apply to all /v1/* routes. The middleware skips public routes
	// (/health, /auth/*, /v1/admin/*) internally.
	//
	app.use("/v1/*", securityProfileMiddleware(securityProfile ?? 'local-dev'));

	// ── GitHub OAuth (public) ────────────────────────────────

	// Redirect user to GitHub for authentication
	app.get("/auth/github", (c) => {
		if (!isGithubOauthConfigured()) {
			return c.json({ error: "GitHub OAuth not configured" }, 503);
		}
		const state = randomBytes(16).toString("hex");
		const origin = new URL(c.req.url).origin;
		const redirectUri = `${origin}/auth/github/callback`;
		c.header("Set-Cookie", `gh_oauth_state=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`);
		return c.redirect(getGithubAuthUrl(state, redirectUri), 302);
	});

	// GitHub OAuth callback — exchange code, issue JWT, redirect to frontend
	app.get("/auth/github/callback", async (c) => {
		const code = c.req.query("code");
		const state = c.req.query("state");
		const cookieHeader = c.req.header("Cookie") ?? "";
		const storedState = cookieHeader
			.split(";")
			.map((p) => p.trim())
			.find((p) => p.startsWith("gh_oauth_state="))
			?.split("=")[1];

		// Clear state cookie
		c.header("Set-Cookie", "gh_oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");

		if (!code || !state || state !== storedState) {
			return c.redirect(
				"/#/oauth/callback?error=" + encodeURIComponent("Invalid OAuth state. Please try again."),
			);
		}

		try {
			const user = await exchangeCodeForUser(code);
			if (!isUserAllowed(user.login)) {
				return c.redirect(
					"/#/oauth/callback?error=" +
						encodeURIComponent(`User "${user.login}" is not allowed. Contact the admin.`),
				);
			}
			const token = createDashboardJwt(user);
			return c.redirect(`/#/oauth/callback?token=${token}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "GitHub OAuth failed";
			return c.redirect("/#/oauth/callback?error=" + encodeURIComponent(msg));
		}
	});

	// Auth config — public endpoint so the frontend knows which login methods are available
	app.get("/v1/admin/auth-config", (c) => {
		return c.json({ githubOauth: isGithubOauthConfigured() });
	});

	// ── Dashboard ───────────────────────────────────────────

	// Cache dashboard HTML at startup to avoid regenerating on every request
	const dashboardHtmlCache = dashboardHtml();
	app.get("/", (c) => c.html(dashboardHtmlCache));

	// ── Health ──────────────────────────────────────────────

	app.get("/health", async (c) => {
		// Calculate uptime in seconds
		const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

		// Get provider statuses for counts
		const providers = await router.getProviderStatuses();
		const availableCount = providers.filter((p) => p.available).length;

		// Detect auth mode
		const authMode = config.authToken ? "bearer" : "disabled";

		// Detect Anthropic subscription tier
		const subscription = detectAnthropicSubscription(vault);

		return c.json({
			status: "ok",
			version: VERSION,
			timestamp: new Date().toISOString(),
			uptime: uptimeSeconds,
			auth: {
				enabled: !!config.authToken,
				mode: authMode,
			},
			providers: {
				total: providers.length,
				available: availableCount,
			},
			subscription: {
				anthropic: subscription,
			},
			mode: "proxy",
		});
	});

	registerObservabilityRoutes(app, {
		router,
		analyticsAggregator,
		requestLogger,
	});
	registerComparisonRoutes(app, { comparisonService });
	registerToolingRoutes(app);

	// ── Generate ───────────────────────────────────────────

	app.post("/v1/generate", async (c) => {
		let logCtx: LogContext | undefined;
		try {
			const body = await c.req.json();

			// Validate with Zod
			let validated: ReturnType<typeof validateGenerateRequest>;
			try {
				validated = validateGenerateRequest(body);
			} catch (error) {
				// Handle ZodError in Zod 4 - issues are accessed via .issues property
				if (error && typeof error === "object" && "issues" in error) {
					const issues = (
						error as { issues: Array<{ message: string; path: string[] }> }
					).issues;
					const firstIssue = issues[0];
					return c.json(
						{
							error: firstIssue?.message ?? "Validation error",
							code: "VALIDATION_ERROR",
							field: firstIssue?.path?.join(".") ?? "",
						},
						400,
					);
				}
				throw error;
			}

			const headerProject = c.req.header("X-Project") ?? undefined;
			const project = resolveProject(validated.project, headerProject);

			// Build prompt and system from three-part fields or flat prompt
			let prompt = validated.prompt ?? '';
			let system = validated.system;

			if (validated.context || validated.instruction) {
				// User explicitly provided three-part fields — compose them
				const parts: string[] = [];
				if (validated.context) {
					parts.push(`[Context]\n${validated.context}`);
				}
				if (validated.instruction) {
					parts.push(`[Instruction]\n${validated.instruction}`);
				}
				prompt = parts.join('\n\n');
			} else if (prompt && !system) {
				// Auto-optimize flat prompt if no system message exists
				const messages = [{ role: 'user' as const, content: prompt }];
				const optimized = optimizeMessages(messages);
				if (
					optimized.length > 1 &&
					optimized[0]?.role === 'system' &&
					typeof optimized[0].content === 'string'
				) {
					system = optimized[0].content;
					const rest = optimized
						.slice(1)
						.map((m) => (typeof m.content === 'string' ? m.content : ''))
						.filter(Boolean)
						.join('\n\n');
					prompt = rest;
				}
			}

			logCtx = requestLogger?.captureStart({
				provider: validated.provider || 'unknown',
				model: validated.model || 'unknown',
				startTime: Date.now(),
			});

			const result = await router.generate({
				prompt,
				model: validated.model,
				provider: validated.provider,
				system,
				maxTokens: validated.maxTokens,
				strict: validated.strict,
				project,
			});

			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, {
					outputTokens: result.tokensUsed || 0,
					responseData: JSON.stringify(result),
				});
			}

			return c.json(result);
		} catch (error) {
			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, {
					error: error instanceof Error ? error : new Error(String(error)),
				});
			}
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	// ── OpenAI-compatible Chat Completions ──────────────────

	app.post("/v1/chat/completions", async (c) => {
		let logCtx: LogContext | undefined;
		try {
			const body = await c.req.json();

			// Validate with Zod
			let validated: ReturnType<typeof validateChatCompletions>;
			try {
				validated = validateChatCompletions(body);
			} catch (error) {
				// Handle ZodError in Zod 4 - issues are accessed via .issues property
				if (error && typeof error === "object" && "issues" in error) {
					const issues = (
						error as { issues: Array<{ message: string; path: string[] }> }
					).issues;
					const firstIssue = issues[0];
					return c.json(
						{
							error: {
								message: firstIssue?.message ?? "Validation error",
								type: "invalid_request_error",
								param: firstIssue?.path?.join(".") || undefined,
								code: null,
							},
						},
						400,
					);
				}
				throw error;
			}

			// Normalize and validate OpenAI-format request via protocol-converter
			let canonicalRequest: import("../protocol-converter/types.js").CanonicalRequest;
			try {
				canonicalRequest = normalizeOpenAIRequest(validated);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json(
					{
						error: {
							message,
							type: "invalid_request_error",
							param: null,
							code: null,
						},
					},
					400,
				);
			}

			// Apply three-part prompt optimization to message array
			const internalMessages = canonicalRequest.messages.map((m) => ({
				role: m.role as 'system' | 'user' | 'assistant' | 'tool',
				content: m.content,
			}));
			const optimizedMessages = optimizeMessages(internalMessages);

			// ── Streaming path ──────────────────────────────────────
			if (canonicalRequest.stream) {
				return handleStreamingRequest(
					c,
					{ ...canonicalRequest, messages: optimizedMessages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })) as { role: 'system' | 'user' | 'assistant'; content: string }[] },
				router,
				costTracker,
				vault,
				requestLogger,
				);
			}

			// Extract system messages → concatenate as system prompt
			const systemMessages = optimizedMessages
				.filter((m) => m.role === 'system')
				.map((m) => (typeof m.content === 'string' ? m.content : ''))
				.filter(Boolean);
			const system =
				systemMessages.length > 0 ? systemMessages.join('\n') : undefined;

			// Extract conversation messages → last user message is the main prompt
			const conversationMessages = optimizedMessages.filter(
				(m) => m.role !== 'system',
			);
			const lastUserMessage = [...conversationMessages]
				.reverse()
				.find((m) => m.role === 'user');

			if (!lastUserMessage) {
				return c.json(
					{
						error: {
							message: 'At least one user message is required',
							type: 'invalid_request_error',
							param: 'messages',
							code: null,
						},
					},
					400,
				);
			}

			// Build prompt: include conversation context if there are earlier messages
			const earlierMessages = conversationMessages.slice(0, -1);
			let prompt = typeof lastUserMessage.content === 'string' ? lastUserMessage.content : '';
			if (earlierMessages.length > 0) {
				const context = earlierMessages
					.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : ''}`)
					.join('\n');
				prompt = `${context}\nuser: ${prompt}`;
			}

			const headerProject = c.req.header('X-Project') ?? undefined;

			logCtx = requestLogger?.captureStart({
				provider: 'unknown',
				model: canonicalRequest.model || 'unknown',
				startTime: Date.now(),
			});

			const result = await router.generate({
				prompt,
				system,
				model: canonicalRequest.model,
				maxTokens: canonicalRequest.max_tokens,
				project: headerProject,
			});

			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, {
					outputTokens: result.tokensUsed || 0,
					responseData: JSON.stringify(result),
				});
			}

			// Build canonical OpenAI response via protocol-converter
			const canonicalResponse = createCanonicalResponse(
				`chatcmpl-${randomUUID()}`,
				result.model,
				result.text,
				{ prompt: 0, completion: result.tokensUsed ?? 0 },
			);

			return c.json({
				...canonicalResponse,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				x_gateway: buildGatewayMetadata(result),
			});
		} catch (error) {
			if (logCtx && requestLogger) {
				await requestLogger.captureEnd(logCtx, {
					error: error instanceof Error ? error : new Error(String(error)),
				});
			}
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: {
						message,
						type: "server_error",
						param: null,
						code: null,
					},
				},
				500,
			);
		}
	});

	// ── Models (OpenAI-compatible format) ──────────────────

	app.get("/v1/models", async (c) => {
		try {
			const models = await router.getAvailableModels();
			return c.json({
				object: "list",
				data: models.map((m) => ({
					id: m.id,
					object: "model",
					created: 0,
					owned_by: "llm-gateway",
					// Gateway-specific fields
					name: m.name,
					provider: m.provider,
					max_tokens: m.maxTokens,
				})),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: {
						message,
						type: "server_error",
						param: null,
						code: null,
					},
				},
				500,
			);
		}
	});

	// ── Providers ──────────────────────────────────────────

	app.get("/v1/providers", async (c) => {
		try {
			const providers = await router.getProviderStatuses();
			return c.json({ providers });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	// ── Latency Measurements ────────────────────────────────

	app.get("/v1/latency", (c) => {
		try {
			if (!latencyMeasurer) {
				return c.json(
					{
						error: "Latency measurement not enabled",
						code: "NOT_ENABLED",
					},
					503,
				);
			}

			const measurements = latencyMeasurer.getAll();
			const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
			const now = Date.now();

			return c.json({
				providers: measurements.map((m) => ({
					provider: m.provider,
					latencyMs: m.latencyMs,
					measuredAt: m.measuredAt,
					stale: now - m.measuredAt > TWO_HOURS_MS,
				})),
				count: measurements.length,
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});


	// ── Cost Estimation ────────────────────────────────────

	app.get("/v1/cost/estimate", (c) => {
		try {
			const query = {
				model: c.req.query("model"),
				inputTokens: c.req.query("inputTokens"),
				outputTokens: c.req.query("outputTokens"),
			};

			const parsed = costEstimateQuerySchema.safeParse(query);
			if (!parsed.success) {
				const issues = parsed.error.issues;
				const firstIssue = issues[0];
				return c.json(
					{
						error: "Validation error",
						details: firstIssue
							? `${firstIssue.path.join(".")}: ${firstIssue.message}`
							: "Invalid query parameters",
					},
					400,
				);
			}

			const result = estimateCost(
				parsed.data.model,
				parsed.data.inputTokens,
				parsed.data.outputTokens,
			);
			if (!result) {
				return c.json({ error: "Unknown model" }, 400);
			}

			return c.json(result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/cost/models", (c) => {
		try {
			const table = getPriceTable();
			return c.json(table);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	// ── Credentials CRUD ───────────────────────────────────

	app.post("/v1/credentials", async (c) => {
		try {
			const body = await c.req.json();

			// Validate with Zod
			let validated: ReturnType<typeof validateCredentialStore>;
			try {
				validated = validateCredentialStore(body);
			} catch (error) {
				// Handle ZodError in Zod 4 - issues are accessed via .issues property
				if (error && typeof error === "object" && "issues" in error) {
					const issues = (
						error as { issues: Array<{ message: string; path: string[] }> }
					).issues;
					const firstIssue = issues[0];
					return c.json(
						{
							error: firstIssue?.message ?? "Validation error",
							code: "VALIDATION_ERROR",
							field: firstIssue?.path?.join(".") ?? "",
							validProviders: [...VALID_PROVIDERS],
						},
						400,
					);
				}
				throw error;
			}

			const keyName = validated.keyName ?? "default";
			const headerProject = c.req.header("X-Project") ?? undefined;
			const project = resolveProject(validated.project, headerProject);
			const id = vault.store(
				validated.provider,
				keyName,
				validated.apiKey,
				project,
			);
			return c.json(
				{
					id,
					provider: validated.provider,
					keyName,
					project: project ?? "_global",
				},
				201,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/credentials", (c) => {
		try {
			const project =
				c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
			const credentials = vault.listMasked(project);
			return c.json({ credentials });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.delete("/v1/credentials/:id", (c) => {
		try {
			const id = Number(c.req.param("id"));

			if (isNaN(id)) {
				return c.json({ error: "id must be a number" }, 400);
			}

			const project =
				c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
			vault.delete(id, project);
			return c.json({ ok: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Return 403 for authorization errors, 404 for not found
			if (message.includes("Unauthorized")) {
				return c.json({ error: message, code: "UNAUTHORIZED" }, 403);
			}
			if (message.includes("not found")) {
				return c.json({ error: message, code: "NOT_FOUND" }, 404);
			}
			return c.json({ error: message }, 500);
		}
	});

	// ── Files CRUD ─────────────────────────────────────────

	app.post("/v1/files", async (c) => {
		try {
			const body = await c.req.json();

			// Validate with Zod
			let validated: ReturnType<typeof validateFileStore>;
			try {
				validated = validateFileStore(body);
			} catch (error) {
				// Handle ZodError in Zod 4 - issues are accessed via .issues property
				if (error && typeof error === "object" && "issues" in error) {
					const issues = (
						error as { issues: Array<{ message: string; path: string[] }> }
					).issues;
					const firstIssue = issues[0];
					return c.json(
						{
							error: firstIssue?.message ?? "Validation error",
							code: "VALIDATION_ERROR",
							field: firstIssue?.path?.join(".") ?? "",
						},
						400,
					);
				}
				throw error;
			}

			const headerProject = c.req.header("X-Project") ?? undefined;
			const project = resolveProject(validated.project, headerProject);
			const id = vault.storeFile(
				validated.provider,
				validated.fileName,
				validated.content,
				project,
			);
			return c.json(
				{
					id,
					provider: validated.provider,
					fileName: validated.fileName,
					project: project ?? "_global",
				},
				201,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.get("/v1/files", (c) => {
		try {
			const project =
				c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
			const files = vault.listFiles(project);
			return c.json({ files });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.delete("/v1/files/:id", (c) => {
		try {
			const id = Number(c.req.param("id"));

			if (isNaN(id)) {
				return c.json({ error: "id must be a number" }, 400);
			}

			const project =
				c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
			vault.deleteFile(id, project);
			return c.json({ ok: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Return 403 for authorization errors, 404 for not found
			if (message.includes("Unauthorized")) {
				return c.json({ error: message, code: "UNAUTHORIZED" }, 403);
			}
			if (message.includes("not found")) {
				return c.json({ error: message, code: "NOT_FOUND" }, 404);
			}
			return c.json({ error: message }, 500);
		}
	});

	// ── Groups CRUD ──────────────────────────────────────────

	if (groupStore) {
		app.get("/v1/groups", (c) => {
			try {
				const groups = groupStore.list();
				return c.json({ groups });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});

		app.post("/v1/groups", async (c) => {
			try {
				const body = await c.req.json();

				let validated: ReturnType<typeof CreateGroupSchema.parse>;
				try {
					validated = CreateGroupSchema.parse(body);
				} catch (error) {
					if (error && typeof error === "object" && "issues" in error) {
						const issues = (
							error as { issues: Array<{ message: string; path: string[] }> }
						).issues;
						const firstIssue = issues[0];
						return c.json(
							{
								error: firstIssue?.message ?? "Validation error",
								code: "VALIDATION_ERROR",
								field: firstIssue?.path?.join(".") ?? "",
							},
							400,
						);
					}
					throw error;
				}

				const group = groupStore.create(validated);
				return c.json(group, 201);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});

		app.put("/v1/groups/:id", async (c) => {
			try {
				const id = c.req.param("id");
				const body = await c.req.json();

				let validated: ReturnType<typeof UpdateGroupSchema.parse>;
				try {
					validated = UpdateGroupSchema.parse(body);
				} catch (error) {
					if (error && typeof error === "object" && "issues" in error) {
						const issues = (
							error as { issues: Array<{ message: string; path: string[] }> }
						).issues;
						const firstIssue = issues[0];
						return c.json(
							{
								error: firstIssue?.message ?? "Validation error",
								code: "VALIDATION_ERROR",
								field: firstIssue?.path?.join(".") ?? "",
							},
							400,
						);
					}
					throw error;
				}

				const updated = groupStore.update(id, validated);
				if (!updated) {
					return c.json(
						{ error: `Group not found: ${id}`, code: "NOT_FOUND" },
						404,
					);
				}
				return c.json(updated);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});

		app.delete("/v1/groups/:id", (c) => {
			try {
				const id = c.req.param("id");
				const deleted = groupStore.delete(id);
				if (!deleted) {
					return c.json(
						{ error: `Group not found: ${id}`, code: "NOT_FOUND" },
						404,
					);
				}
				return c.json({ ok: true });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});
	}

	// ── Usage / Cost Tracking ──────────────────────────────

	if (costTracker) {
		app.get("/v1/usage", (c) => {
			try {
				const provider = c.req.query("provider") ?? undefined;
				const model = c.req.query("model") ?? undefined;
				const project =
					c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
				const from = c.req.query("from") ?? undefined;
				const to = c.req.query("to") ?? undefined;
				const groupBy = c.req.query("groupBy") as
					| "provider"
					| "model"
					| "project"
					| "hour"
					| "day"
					| undefined;
				const limitStr = c.req.query("limit");
				const limit = limitStr ? parseInt(limitStr, 10) : undefined;

				const records = costTracker.query({
					provider,
					model,
					project,
					from,
					to,
					groupBy,
					limit,
				});
				return c.json({ records, count: records.length });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});

		app.get("/v1/usage/summary", (c) => {
			try {
				const provider = c.req.query("provider") ?? undefined;
				const model = c.req.query("model") ?? undefined;
				const project =
					c.req.query("project") ?? c.req.header("X-Project") ?? undefined;
				const from = c.req.query("from") ?? undefined;
				const to = c.req.query("to") ?? undefined;
				const groupBy = c.req.query("groupBy") as
					| "provider"
					| "model"
					| "project"
					| "hour"
					| "day"
					| undefined;

				const summary = costTracker.summary({
					provider,
					model,
					project,
					from,
					to,
					groupBy,
				});
				return c.json(summary);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});
	}

	// ── Circuit Breaker Config ────────────────────────────

	app.get("/v1/circuit-breaker/config", (c) => {
		try {
			const cbRegistry = getCircuitBreakerRegistry();
			const config = cbRegistry.getDefaultConfig();
			return c.json({
				enabled: cbRegistry.isEnabled(),
				failureThreshold: config.failureThreshold,
				backoffBaseMs: config.backoffBaseMs,
				backoffMultiplier: config.backoffMultiplier,
				backoffMaxMs: config.backoffMaxMs,
				resetTimeoutMs: config.resetTimeoutMs,
				halfOpenSuccessThreshold: config.halfOpenSuccessThreshold,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	app.put("/v1/circuit-breaker/config", async (c) => {
		try {
			const body = await c.req.json();
			const cbRegistry = getCircuitBreakerRegistry();

			const update: Record<string, unknown> = {};
			if (
				typeof body.failureThreshold === "number" &&
				body.failureThreshold > 0
			) {
				update["failureThreshold"] = body.failureThreshold;
			}
			if (typeof body.backoffBaseMs === "number" && body.backoffBaseMs > 0) {
				update["backoffBaseMs"] = body.backoffBaseMs;
			}
			if (
				typeof body.backoffMultiplier === "number" &&
				body.backoffMultiplier > 0
			) {
				update["backoffMultiplier"] = body.backoffMultiplier;
			}
			if (typeof body.backoffMaxMs === "number" && body.backoffMaxMs > 0) {
				update["backoffMaxMs"] = body.backoffMaxMs;
			}
			if (typeof body.resetTimeoutMs === "number" && body.resetTimeoutMs > 0) {
				update["resetTimeoutMs"] = body.resetTimeoutMs;
			}
			if (
				typeof body.halfOpenSuccessThreshold === "number" &&
				body.halfOpenSuccessThreshold > 0
			) {
				update["halfOpenSuccessThreshold"] = body.halfOpenSuccessThreshold;
			}

			if (Object.keys(update).length === 0) {
				return c.json(
					{
						error: "No valid config fields provided",
						code: "VALIDATION_ERROR",
					},
					400,
				);
			}

			cbRegistry.updateDefaultConfig(update as Record<string, number>);
			const newConfig = cbRegistry.getDefaultConfig();
			return c.json({
				updated: true,
				config: {
					enabled: cbRegistry.isEnabled(),
					failureThreshold: newConfig.failureThreshold,
					backoffBaseMs: newConfig.backoffBaseMs,
					backoffMultiplier: newConfig.backoffMultiplier,
					backoffMaxMs: newConfig.backoffMaxMs,
					resetTimeoutMs: newConfig.resetTimeoutMs,
					halfOpenSuccessThreshold: newConfig.halfOpenSuccessThreshold,
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	// ── Circuit Breaker Stats ────────────────────────────

	app.get("/v1/circuit-breaker/stats", (c) => {
		try {
			const cbRegistry = getCircuitBreakerRegistry();
			const stats = cbRegistry.getAllStats();
			return c.json({
				enabled: cbRegistry.isEnabled(),
				breakers: stats,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 500);
		}
	});

	// ── Approval Management ───────────────────────────────

	if (approvalStore) {
		app.get("/v1/approvals", (c) => {
			try {
				const pending = approvalStore.getPending();
				return c.json({ requests: pending, count: pending.length });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});

		app.post("/v1/approvals/:id/approve", (c) => {
			try {
				const id = c.req.param("id");
				const resolvedBy = c.req.header("X-User-Id") ?? 'admin';
				const updated = approvalStore.approve(id, resolvedBy);
				if (!updated) {
					return c.json(
						{ error: "Approval request not found or already resolved", code: "NOT_FOUND" },
						404,
					);
				}
				return c.json(updated);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});

		app.post("/v1/approvals/:id/deny", (c) => {
			try {
				const id = c.req.param("id");
				const resolvedBy = c.req.header("X-User-Id") ?? 'admin';
				const updated = approvalStore.deny(id, resolvedBy);
				if (!updated) {
					return c.json(
						{ error: "Approval request not found or already resolved", code: "NOT_FOUND" },
						404,
					);
				}
				return c.json(updated);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return c.json({ error: message }, 500);
			}
		});
	}

	// ── Admin Dashboard API ────────────────────────────────

	registerAdminRoutes(app, {
		router,
		vault,
		config,
		groupStore,
		costTracker,
		serverStartTime,
		freeModelRouter,
		db,
		sessionManager,
	});

	// ── Start ──────────────────────────────────────────────

	const server = serve(
		{
			fetch: app.fetch,
			port: config.httpPort,
		},
		(info) => {
			logger.info({ port: info.port }, "HTTP server started");
		},
	);

	return server;
}

export function startHttpServer(deps: StartHttpServerDeps): ServerType;
export function startHttpServer(
	router: Router,
	vault: Vault,
	config: GatewayConfig,
	groupStore?: GroupStore,
	costTracker?: CostTracker,
	latencyMeasurer?: LatencyMeasurer,
	freeModelRouter?: FreeModelRouter,
	db?: Database.Database,
	analyticsAggregator?: AnalyticsAggregator,
	comparisonService?: ComparisonService,
	securityProfile?: TrustLevel,
	approvalStore?: ApprovalStore,
	sessionManager?: SessionManager,
	requestLogger?: RequestLogger,
	..._rest: unknown[]
): ServerType;
export function startHttpServer(
	routerOrDeps: Router | StartHttpServerDeps,
	vault?: Vault,
	config?: GatewayConfig,
	groupStore?: GroupStore,
	costTracker?: CostTracker,
	latencyMeasurer?: LatencyMeasurer,
	freeModelRouter?: FreeModelRouter,
	db?: Database.Database,
	analyticsAggregator?: AnalyticsAggregator,
	comparisonService?: ComparisonService,
	securityProfile?: TrustLevel,
	approvalStore?: ApprovalStore,
	sessionManager?: SessionManager,
	requestLogger?: RequestLogger,
	..._rest: unknown[]
): ServerType {
	if (isStartHttpServerDeps(routerOrDeps)) {
		return startHttpServerWithDeps(routerOrDeps);
	}

	if (!vault || !config) {
		throw new Error("startHttpServer requires vault and config");
	}

	return startHttpServerWithDeps({
		router: routerOrDeps,
		vault,
		config,
		groupStore,
		costTracker,
		latencyMeasurer,
		freeModelRouter,
		db,
		analyticsAggregator,
		comparisonService,
		securityProfile,
		approvalStore,
		sessionManager,
		requestLogger,
	});
}
