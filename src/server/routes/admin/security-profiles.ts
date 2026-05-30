import type { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { z } from 'zod';

import { ToolCategorySchema, TrustLevelSchema } from '../../../security/profiles.js';

export interface AdminSecurityProfilesRouteDeps {
  db?: Database.Database;
}

const CreateProfileSchema = z.object({
  project: z.string().min(1),
  trustLevel: TrustLevelSchema.optional().default('restricted'),
  allowedCategories: z.array(ToolCategorySchema).min(1),
  rateLimitMax: z.number().int().positive().nullable().optional().default(null),
  rateLimitWindowMs: z.number().int().positive().nullable().optional().default(null),
  sandbox: z.boolean().optional().default(false),
});

export function registerAdminSecurityProfileRoutes(
  app: Hono,
  deps: AdminSecurityProfilesRouteDeps,
): void {
  app.post('/v1/admin/profiles', async (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const body = await c.req.json();
      const parsed = CreateProfileSchema.safeParse(body);

      if (!parsed.success) {
        return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
      }

      const { project, trustLevel, allowedCategories, rateLimitMax, rateLimitWindowMs, sandbox } = parsed.data;

      const stmt = deps.db.prepare(`
        INSERT INTO security_profiles (project, trust_level, allowed_categories, rate_limit_max, rate_limit_window_ms, sandbox, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(project) DO UPDATE SET
          trust_level = excluded.trust_level,
          allowed_categories = excluded.allowed_categories,
          rate_limit_max = excluded.rate_limit_max,
          rate_limit_window_ms = excluded.rate_limit_window_ms,
          sandbox = excluded.sandbox,
          updated_at = datetime('now')
      `);

      stmt.run(
        project,
        trustLevel,
        JSON.stringify(allowedCategories),
        rateLimitMax,
        rateLimitWindowMs,
        sandbox ? 1 : 0,
      );

      return c.json({
        ok: true,
        project,
        trustLevel,
        allowedCategories,
        rateLimitMax,
        rateLimitWindowMs,
        sandbox,
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.get('/v1/admin/profiles', (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const rows = deps.db.prepare('SELECT * FROM security_profiles ORDER BY project').all() as Array<{
        id: number;
        project: string;
        trust_level: string;
        allowed_categories: string;
        rate_limit_max: number | null;
        rate_limit_window_ms: number | null;
        sandbox: number;
        created_at: string;
        updated_at: string;
      }>;

      const profiles = rows.map((row) => ({
        id: row.id,
        project: row.project,
        trustLevel: row.trust_level,
        allowedCategories: JSON.parse(row.allowed_categories) as string[],
        rateLimitMax: row.rate_limit_max,
        rateLimitWindowMs: row.rate_limit_window_ms,
        sandbox: Boolean(row.sandbox),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return c.json({ profiles });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });

  app.delete('/v1/admin/profiles/:project', (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: 'Database not configured', code: 'NOT_CONFIGURED' }, 500);
      }

      const project = c.req.param('project');
      const result = deps.db.prepare('DELETE FROM security_profiles WHERE project = ?').run(project);

      if (result.changes === 0) {
        return c.json({ error: `No profile found for project "${project}"`, code: 'NOT_FOUND' }, 404);
      }

      return c.json({ ok: true, project, message: `Profile for "${project}" deleted` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
}
