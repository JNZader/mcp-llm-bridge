/**
 * HTTP Server — Hono-based REST API for the LLM Gateway.
 *
 * Provides HTTP endpoints for LLM generation, model listing,
 * provider status, and credential management.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import type { GenerateRequest, GatewayConfig } from '../core/types.js';
import type { Router } from '../core/router.js';
import type { Vault } from '../vault/vault.js';
import { dashboardHtml } from './dashboard.js';

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

  // ── Dashboard ───────────────────────────────────────────

  app.get('/', (c) => c.html(dashboardHtml()));

  // ── Health ──────────────────────────────────────────────

  app.get('/health', (c) => {
    return c.json({ status: 'ok', version: '0.2.0' });
  });

  // ── Generate ───────────────────────────────────────────

  app.post('/v1/generate', async (c) => {
    try {
      const body = await c.req.json<GenerateRequest>();

      if (!body.prompt) {
        return c.json({ error: 'prompt is required' }, 400);
      }

      const result = await router.generate(body);
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  // ── Models ─────────────────────────────────────────────

  app.get('/v1/models', async (c) => {
    try {
      const models = await router.getAvailableModels();
      return c.json({ models });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
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
      }>();

      if (!body.provider || !body.apiKey) {
        return c.json({ error: 'provider and apiKey are required' }, 400);
      }

      const keyName = body.keyName ?? 'default';
      const id = vault.store(body.provider, keyName, body.apiKey);
      return c.json({ id, provider: body.provider, keyName }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.get('/v1/credentials', (c) => {
    try {
      const credentials = vault.listMasked();
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

      vault.delete(id);
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
      console.error(
        `[llm-gateway] HTTP server listening on http://localhost:${String(info.port)}`,
      );
    },
  );
}
