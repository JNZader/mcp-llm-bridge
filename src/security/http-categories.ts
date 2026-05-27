/**
 * HTTP route categories — maps REST endpoints to security profile categories.
 *
 * Analogous to TOOL_CATEGORIES but for HTTP routes. Used by
 * securityProfileMiddleware to enforce per-profile endpoint access.
 */

import type { ToolCategory } from './profiles.js';

/**
 * Route category mapping.
 *
 * Keys are either:
 * - Exact path (e.g. `/v1/generate`) — applies to all methods
 * - Method + path (e.g. `POST /v1/credentials`) — method-specific override
 *
 * Resolution order:
 * 1. Check `METHOD path` for an exact match
 * 2. Fall back to `path` (method-agnostic)
 * 3. Default to 'read' for known /v1/* prefixes
 * 4. Block unknown routes
 */
export const ROUTE_CATEGORIES: Record<string, ToolCategory> = {
  // ── generate ─────────────────────────────────────────────
  '/v1/generate': 'generate',
  '/v1/chat/completions': 'generate',
  '/v1/models': 'generate',

  // ── read ───────────────────────────────────────────────
  '/v1/providers': 'read',
  '/v1/latency': 'read',
  '/v1/usage': 'read',
  '/v1/usage/summary': 'read',
  '/v1/credentials': 'read',       // GET — read
  '/v1/files': 'read',             // GET — read
  '/v1/groups': 'read',            // GET — read
  '/v1/compare/history': 'read',
  '/v1/cost/estimate': 'read',
  '/v1/cost/models': 'read',
  '/v1/circuit-breaker/config': 'read',
  '/v1/circuit-breaker/stats': 'read',
  '/v1/approvals': 'read',         // GET — read
  '/v1/compression/stats': 'read',  // GET — read
  '/v1/local/models': 'read',       // GET — read

  // ── destructive (method-specific overrides) ────────────
  'POST /v1/credentials': 'destructive',
  'DELETE /v1/credentials': 'destructive',
  'POST /v1/files': 'destructive',
  'DELETE /v1/files': 'destructive',
  'POST /v1/groups': 'destructive',
  'PUT /v1/groups': 'destructive',
  'DELETE /v1/groups': 'destructive',
  'POST /v1/compare': 'destructive',
  'PUT /v1/circuit-breaker/config': 'destructive',

  // ── admin ────────────────────────────────────────────────
  '/v1/admin/auth-config': 'admin',
  // All other /v1/admin/* are handled by adminAuth separately
} as const;

/** Check if a route is under /v1/admin (excluded from profile middleware). */
export function isAdminRoute(path: string): boolean {
  return path.startsWith('/v1/admin/');
}
