import type { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { z } from 'zod';

import { createApiKey, revokeApiKey, listApiKeys } from '../../../auth/keys.js';
import { TrustLevelSchema } from '../../../security/profiles.js';

export interface AdminApiKeysRouteDeps {
  db?: Database.Database;
}

const CreateKeySchema = z.object({
  userId: z.string().min(1),
  project: z.string().optional(),
  trustLevel: TrustLevelSchema.optional(),
  rateLimitMax: z.number().int().positive().optional(),
  rateLimitWindowMs: z.number().int().positive().optional(),
  budgetUsd: z.number().nonnegative().optional(),
  expiresAt: z.string().optional(),
});

export function registerAdminApiKeyRoutes(
  app: Hono,
  deps: AdminApiKeysRouteDeps,
): void {
  /**
   * POST /v1/admin/keys — Create a new API key.
   *
   * Returns the plaintext key ONCE in the response. It is never stored
   * or returned again — only the hash is persisted.
   */
  app.post('/v1/admin/keys', async (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const body = await c.req.json();
      const parsed = CreateKeySchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
      }

      const { apiKey, plaintextKey } = createApiKey(deps.db, parsed.data);

      return c.json({
        ok: true,
        key: plaintextKey,
        id: apiKey.id,
        keyPrefix: apiKey.keyPrefix,
        userId: apiKey.userId,
        project: apiKey.project,
        trustLevel: apiKey.trustLevel,
        rateLimitMax: apiKey.rateLimitMax,
        rateLimitWindowMs: apiKey.rateLimitWindowMs,
        budgetUsd: apiKey.budgetUsd,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * GET /v1/admin/keys — List all API keys (masked, no hashes).
   *
   * Optionally filter by userId query parameter.
   */
  app.get('/v1/admin/keys', (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const userId = c.req.query('userId');
      const keys = listApiKeys(deps.db, userId ?? undefined);

      const masked = keys.map((k) => ({
        id: k.id,
        keyPrefix: k.keyPrefix,
        userId: k.userId,
        project: k.project,
        trustLevel: k.trustLevel,
        rateLimitMax: k.rateLimitMax,
        rateLimitWindowMs: k.rateLimitWindowMs,
        budgetUsd: k.budgetUsd,
        enabled: k.enabled,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      }));

      return c.json({ keys: masked });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * DELETE /v1/admin/keys/:id — Revoke an API key.
   *
   * Does NOT delete the row — sets enabled=0 to keep audit trail.
   */
  app.delete('/v1/admin/keys/:id', (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const id = c.req.param('id');
      const revoked = revokeApiKey(deps.db, id);

      if (!revoked) {
        return c.json({ error: `No API key found with id "${id}"`, code: 'NOT_FOUND' }, 404);
      }

      return c.json({ ok: true, id, message: `API key ${id} revoked` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
}
