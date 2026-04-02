/**
 * Security Profiles — trust-level-based tool filtering and rate limiting.
 *
 * Defines 3 trust levels (local-dev, restricted, open) with static tool
 * whitelists and per-profile rate limiting configuration.
 * Follows the Zod schema pattern from GroupStore (src/core/groups.ts).
 */

import { z } from 'zod';
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
