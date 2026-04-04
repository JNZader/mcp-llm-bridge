/**
 * Security Profiles — trust-level-based tool filtering and rate limiting.
 *
 * Defines 3 trust levels (local-dev, restricted, open) with static tool
 * whitelists and per-profile rate limiting configuration.
 * Follows the Zod schema pattern from GroupStore (src/core/groups.ts).
 */

import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { TrustLevel } from '../core/types.js';

// ── Zod Schemas ────────────────────────────────────────────

export const ToolCategorySchema = z.enum([
  'destructive',
  'read',
  'generate',
  'admin',
]);

export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const RateLimitConfigSchema = z
  .object({
    max: z.number().int().positive(),
    windowMs: z.number().int().positive(),
  })
  .nullable();

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

export const TrustLevelSchema = z.enum(['local-dev', 'restricted', 'open']);

export const SecurityProfileSchema = z.object({
  level: TrustLevelSchema,
  allowedCategories: z.array(ToolCategorySchema).min(1),
  rateLimit: RateLimitConfigSchema,
});

export type SecurityProfile = z.infer<typeof SecurityProfileSchema>;

// ── Tool Categories ────────────────────────────────────────

/**
 * Maps every registered MCP tool name to its security category.
 *
 * Categories:
 * - destructive: tools that create, modify, or delete data
 * - read: tools that only read/query data
 * - generate: LLM generation and model listing
 * - admin: system configuration and indexing tools
 */
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // generate
  llm_generate: 'generate',
  llm_models: 'generate',

  // destructive
  vault_store: 'destructive',
  vault_delete: 'destructive',
  vault_store_file: 'destructive',
  vault_delete_file: 'destructive',
  create_group: 'destructive',
  delete_group: 'destructive',

  // read
  vault_list: 'read',
  vault_list_files: 'read',
  list_groups: 'read',
  circuit_breaker_stats: 'read',
  usage_summary: 'read',
  usage_query: 'read',
  code_search: 'read',

  // admin
  configure_circuit_breaker: 'admin',
  index_codebase: 'admin',
  shared_state: 'admin',
} as const;

// ── Profile Definitions ────────────────────────────────────

/**
 * Static profile map.
 *
 * - local-dev: all categories, no rate limit (backward compatible)
 * - restricted: read + generate only, 100 req / 15 min
 * - open: generate only, 10 req / 15 min
 */
export const PROFILES: Record<TrustLevel, SecurityProfile> = {
  'local-dev': SecurityProfileSchema.parse({
    level: 'local-dev',
    allowedCategories: ['destructive', 'read', 'generate', 'admin'],
    rateLimit: null,
  }),
  restricted: SecurityProfileSchema.parse({
    level: 'restricted',
    allowedCategories: ['read', 'generate'],
    rateLimit: { max: 100, windowMs: 15 * 60 * 1000 },
  }),
  open: SecurityProfileSchema.parse({
    level: 'open',
    allowedCategories: ['generate'],
    rateLimit: { max: 10, windowMs: 15 * 60 * 1000 },
  }),
} as const;

// ── Profile Resolver ──────────────────────────────────────

/**
 * A function that resolves a SecurityProfile for a given project.
 * Returns a SecurityProfile or null if no custom profile exists
 * (caller should fall back to static PROFILES).
 */
export type ProfileResolver = (project: string) => SecurityProfile | null;

/** Row shape returned from the security_profiles table. */
interface DbProfileRow {
  id: number;
  project: string;
  trust_level: string;
  allowed_categories: string;
  rate_limit_max: number | null;
  rate_limit_window_ms: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Create a ProfileResolver backed by the security_profiles DB table.
 *
 * Queries the DB by project name. If a row exists, builds a SecurityProfile
 * from the stored data. If no row exists, returns null so the caller can
 * fall back to the static PROFILES map.
 */
export function createDbProfileResolver(db: Database.Database): ProfileResolver {
  const stmt = db.prepare<[string], DbProfileRow>(
    'SELECT * FROM security_profiles WHERE project = ?',
  );

  return (project: string): SecurityProfile | null => {
    const row = stmt.get(project);
    if (!row) return null;

    // Parse stored JSON array of allowed categories
    let categories: string[];
    try {
      categories = JSON.parse(row.allowed_categories);
    } catch {
      categories = [];
    }

    // Validate categories against known values
    const validCategories = categories.filter(
      (c) => ToolCategorySchema.safeParse(c).success,
    );

    if (validCategories.length === 0) {
      // Fall back to static profile if stored categories are invalid
      const staticProfile = PROFILES[row.trust_level as TrustLevel];
      return staticProfile ?? null;
    }

    const rateLimit =
      row.rate_limit_max != null && row.rate_limit_window_ms != null
        ? { max: row.rate_limit_max, windowMs: row.rate_limit_window_ms }
        : null;

    return {
      level: (TrustLevelSchema.safeParse(row.trust_level).success
        ? row.trust_level
        : 'restricted') as TrustLevel,
      allowedCategories: validCategories as [ToolCategory, ...ToolCategory[]],
      rateLimit,
    };
  };
}
