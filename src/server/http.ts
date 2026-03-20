/**
 * HTTP Server — Hono-based REST API for the LLM Gateway.
 *
 * Provides HTTP endpoints for LLM generation, model listing,
 * provider status, and credential management.
 *
 * Supports per-project scoping via `project` body field or `X-Project` header.
 */

import { timingSafeEqual, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import type { Context, Next } from 'hono';

import type { GenerateRequest, GatewayConfig } from '../core/types.js';
import type { Router } from '../core/router.js';
import type { Vault } from '../vault/vault.js';
import { dashboardHtml } from './dashboard.js';
import { VERSION, MAX_BODY_SIZE } from '../core/constants.js';
import { logger } from '../core/logger.js';
import { RateLimiter } from './rate-limit.js';

/**
 * Timing-safe comparison for bearer tokens.
 * Returns true if both tokens are equal, using constant-time comparison
 * to prevent timing attacks.
 */
function tokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Bearer token auth middleware.
 *
 * - If `config.authToken` is not set → all requests pass (auth disabled).
 * - Skips `GET /health` (Coolify health checks) and `OPTIONS *` (CORS preflight).
 * - The dashboard HTML at `GET /` is always served (auth is handled in-browser).
 * - All other routes require `Authorization: Bearer <token>`.
 */
function bearerAuth(config: GatewayConfig) {
  return async (c: Context, next: Next) => {
    // No token configured → auth disabled (local dev)
    if (!config.authToken) {
      return next();
    }

    // Always allow health checks (Coolify, uptime monitors)
    if (c.req.method === 'GET' && c.req.path === '/health') {
      return next();
    }

    // CORS preflight must pass through (handled by cors middleware)
    if (c.req.method === 'OPTIONS') {
      return next();
    }

    // Dashboard HTML is served without auth — the JS handles auth client-side
    if (c.req.method === 'GET' && c.req.path === '/') {
      return next();
    }

    // Check Authorization header
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    if (!tokenEquals(parts[1], config.authToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}

/**
 * Extract project from request: body field takes priority, then X-Project header.
 */
function resolveProject(bodyProject: string | undefined, headerProject: string | undefined): string | undefined {
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
  const envOrigins = process.env['LLM_GATEWAY_CORS_ORIGINS'];
  if (!envOrigins) {
    // Default: allow only GitHub Pages hosted dashboard
    return ['https://jnzader.github.io'];
  }
  if (envOrigins === '*') {
    // CORS '*' is allowed but we return it as-is
    return '*';
  }
  return envOrigins.split(',').map((o) => o.trim());
}

/**
 * Request body size limit middleware.
 * Rejects requests with bodies larger than MAX_BODY_SIZE.
 */
async function bodySizeLimit(c: Context, next: Next): Promise<void> {
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    c.status(413);
    c.json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  await next();
}

/**
 * Get the client IP address from the request.
 * Handles X-Forwarded-For header for proxied requests.
 */
function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0];
    return firstIp?.trim() ?? 'unknown';
  }
  return c.req.header('x-real-ip') ?? 'unknown';
}

/**
 * Rate limit middleware factory.
 * Creates a middleware that rate limits requests per IP.
 */
function rateLimitMiddleware(limiter: RateLimiter) {
  return async (c: Context, next: Next): Promise<void> => {
    // Skip rate limiting for health checks
    if (c.req.method === 'GET' && c.req.path === '/health') {
      return next();
    }

    const ip = getClientIp(c);

    if (limiter.isRateLimited(ip)) {
      const resetAt = limiter.getResetAt(ip);
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(Math.floor(resetAt / 1000)));
      c.status(429);
      c.json({
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retryAfter,
      });
      return;
    }

    // Add rate limit headers to response
    c.header('X-RateLimit-Remaining', String(limiter.getRemaining(ip)));
    c.header('X-RateLimit-Reset', String(Math.floor(limiter.getResetAt(ip) / 1000)));

    await next();
  };
}

/**
 * Start the HTTP server on the configured port.
 *
 * All endpoints share the same Router and Vault instances
 * as the MCP server.
 */
export function startHttpServer(
  router: Router,
  vault: Vault,
  config: GatewayConfig,
): void {
  const app = new Hono();

  // ── Rate limiter — 100 requests per 15 minutes per IP ──
  const rateLimiter = new RateLimiter();

  // ── Security middleware ────────────────────────────────

  // Rate limiting
  app.use('*', rateLimitMiddleware(rateLimiter));

  // Body size limit
  app.use('*', bodySizeLimit);

  // ── CORS — configurable via LLM_GATEWAY_CORS_ORIGINS ──
  const corsOrigins = getCorsOrigins();
  app.use('*', cors({
    origin: corsOrigins === '*' ? '*' : corsOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Project'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  }));

  // ── Auth — bearer token middleware ─────────────────────
  app.use('*', bearerAuth(config));

  // ── Dashboard ───────────────────────────────────────────

  app.get('/', (c) => c.html(dashboardHtml()));

  // ── Health ──────────────────────────────────────────────

  app.get('/health', (c) => {
    return c.json({ status: 'ok', version: VERSION });
  });

  // ── Generate ───────────────────────────────────────────

  app.post('/v1/generate', async (c) => {
    try {
      const body = await c.req.json<GenerateRequest>();

      if (!body.prompt) {
        return c.json({ error: 'prompt is required' }, 400);
      }

      const headerProject = c.req.header('X-Project') ?? undefined;
      const project = resolveProject(body.project, headerProject);

      const result = await router.generate({
        ...body,
        strict: body.strict,
        project,
      });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // ── OpenAI-compatible Chat Completions ──────────────────

  app.post('/v1/chat/completions', async (c) => {
    try {
      const body = await c.req.json<{
        model?: string;
        messages?: Array<{
          role: 'system' | 'user' | 'assistant';
          content: string;
        }>;
        max_tokens?: number;
        temperature?: number;
        stream?: boolean;
      }>();

      // Reject streaming — not supported
      if (body.stream) {
        return c.json({
          error: {
            message: 'Streaming not supported',
            type: 'invalid_request_error',
            param: 'stream',
            code: null,
          },
        }, 400);
      }

      // Validate messages
      if (!body.messages || body.messages.length === 0) {
        return c.json({
          error: {
            message: 'messages is required',
            type: 'invalid_request_error',
            param: 'messages',
            code: null,
          },
        }, 400);
      }

      // Extract system messages → concatenate as system prompt
      const systemMessages = body.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content);
      const system = systemMessages.length > 0 ? systemMessages.join('\n') : undefined;

      // Extract conversation messages → last user message is the main prompt
      const conversationMessages = body.messages.filter((m) => m.role !== 'system');
      const lastUserMessage = [...conversationMessages].reverse().find((m) => m.role === 'user');

      if (!lastUserMessage) {
        return c.json({
          error: {
            message: 'At least one user message is required',
            type: 'invalid_request_error',
            param: 'messages',
            code: null,
          },
        }, 400);
      }

      // Build prompt: include conversation context if there are earlier messages
      const earlierMessages = conversationMessages.slice(0, -1);
      let prompt = lastUserMessage.content;
      if (earlierMessages.length > 0) {
        const context = earlierMessages
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n');
        prompt = `${context}\nuser: ${lastUserMessage.content}`;
      }

      const headerProject = c.req.header('X-Project') ?? undefined;

      const result = await router.generate({
        prompt,
        system,
        model: body.model,
        maxTokens: body.max_tokens,
        project: headerProject,
      });

      return c.json({
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.text,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: result.tokensUsed ?? 0,
        },
        x_gateway: buildGatewayMetadata(result),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({
        error: {
          message,
          type: 'server_error',
          param: null,
          code: null,
        },
      }, 500);
    }
  });

  // ── Models (OpenAI-compatible format) ──────────────────

  app.get('/v1/models', async (c) => {
    try {
      const models = await router.getAvailableModels();
      return c.json({
        object: 'list',
        data: models.map((m) => ({
          id: m.id,
          object: 'model',
          created: 0,
          owned_by: 'llm-gateway',
          // Gateway-specific fields
          name: m.name,
          provider: m.provider,
          max_tokens: m.maxTokens,
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({
        error: {
          message,
          type: 'server_error',
          param: null,
          code: null,
        },
      }, 500);
    }
  });

  // ── Providers ──────────────────────────────────────────

  app.get('/v1/providers', async (c) => {
    try {
      const providers = await router.getProviderStatuses();
      return c.json({ providers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // ── Credentials CRUD ───────────────────────────────────

  app.post('/v1/credentials', async (c) => {
    try {
      const body = await c.req.json<{
        provider: string;
        keyName?: string;
        apiKey: string;
        project?: string;
      }>();

      if (!body.provider || !body.apiKey) {
        return c.json({ error: 'provider and apiKey are required' }, 400);
      }

      const keyName = body.keyName ?? 'default';
      const headerProject = c.req.header('X-Project') ?? undefined;
      const project = resolveProject(body.project, headerProject);
      const id = vault.store(body.provider, keyName, body.apiKey, project);
      return c.json({ id, provider: body.provider, keyName, project: project ?? '_global' }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.get('/v1/credentials', (c) => {
    try {
      const project = c.req.query('project') ?? c.req.header('X-Project') ?? undefined;
      const credentials = vault.listMasked(project);
      return c.json({ credentials });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.delete('/v1/credentials/:id', (c) => {
    try {
      const id = Number(c.req.param('id'));

      if (isNaN(id)) {
        return c.json({ error: 'id must be a number' }, 400);
      }

      const project = c.req.query('project') ?? c.req.header('X-Project') ?? undefined;
      vault.delete(id, project);
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Return 403 for authorization errors, 404 for not found
      if (message.includes('Unauthorized')) {
        return c.json({ error: message, code: 'UNAUTHORIZED' }, 403);
      }
      if (message.includes('not found')) {
        return c.json({ error: message, code: 'NOT_FOUND' }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // ── Files CRUD ─────────────────────────────────────────

  app.post('/v1/files', async (c) => {
    try {
      const body = await c.req.json<{
        provider: string;
        fileName: string;
        content: string;
        project?: string;
      }>();

      if (!body.provider || !body.fileName || !body.content) {
        return c.json({ error: 'provider, fileName, and content are required' }, 400);
      }

      const headerProject = c.req.header('X-Project') ?? undefined;
      const project = resolveProject(body.project, headerProject);
      const id = vault.storeFile(body.provider, body.fileName, body.content, project);
      return c.json({ id, provider: body.provider, fileName: body.fileName, project: project ?? '_global' }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.get('/v1/files', (c) => {
    try {
      const project = c.req.query('project') ?? c.req.header('X-Project') ?? undefined;
      const files = vault.listFiles(project);
      return c.json({ files });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.delete('/v1/files/:id', (c) => {
    try {
      const id = Number(c.req.param('id'));

      if (isNaN(id)) {
        return c.json({ error: 'id must be a number' }, 400);
      }

      const project = c.req.query('project') ?? c.req.header('X-Project') ?? undefined;
      vault.deleteFile(id, project);
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Return 403 for authorization errors, 404 for not found
      if (message.includes('Unauthorized')) {
        return c.json({ error: message, code: 'UNAUTHORIZED' }, 403);
      }
      if (message.includes('not found')) {
        return c.json({ error: message, code: 'NOT_FOUND' }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });

  // ── Start ──────────────────────────────────────────────

  serve(
    {
      fetch: app.fetch,
      port: config.httpPort,
    },
    (info) => {
      logger.info({ port: info.port }, 'HTTP server started');
    },
  );
}
