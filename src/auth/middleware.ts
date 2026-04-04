/**
 * Auth Middleware — Hono middleware for API key authentication.
 *
 * Extracts Bearer token from Authorization header, hashes it,
 * looks up the key in the api_keys table, and attaches UserContext
 * to the request context. Enforces rate limits and key validity.
 *
 * Security:
 * - Uses SHA-256 hashing + timing-safe comparison (via lookupByHash).
 * - Checks `enabled` flag and `expires_at` on every request.
 * - Returns 401 for invalid/revoked/expired keys.
 * - Returns 429 with Retry-After header when rate limited.
 */

import type { Context, Next } from 'hono';
import type Database from 'better-sqlite3';
import type { CostTracker } from '../core/cost-tracker.js';
import type { UserContext } from './types.js';
import { hashApiKey, lookupByHash } from './keys.js';
import { checkRateLimit, checkBudget } from './quotas.js';

/**
 * Create a Hono middleware that authenticates requests via API keys.
 *
 * On success, sets `c.set('userContext', UserContext)` for downstream handlers.
 * On failure, returns 401 (invalid key) or 429 (rate limited).
 *
 * @param db - Database instance with `api_keys` table.
 * @param costTracker - Optional CostTracker for budget checks.
 */
export function apiKeyAuth(db: Database.Database, costTracker?: CostTracker) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized', code: 'MISSING_AUTH' }, 401);
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      return c.json({ error: 'Unauthorized', code: 'INVALID_AUTH_FORMAT' }, 401);
    }

    const token = parts[1];

    // Hash the token and look up in db (timing-safe comparison inside lookupByHash)
    const hash = hashApiKey(token);
    const apiKey = lookupByHash(db, hash);

    if (!apiKey) {
      return c.json({ error: 'Unauthorized', code: 'INVALID_KEY' }, 401);
    }

    // Check if key is enabled (revoked keys have enabled=false)
    if (!apiKey.enabled) {
      return c.json({ error: 'Unauthorized', code: 'KEY_REVOKED' }, 401);
    }

    // Check expiration
    if (apiKey.expiresAt) {
      const expiresAt = new Date(apiKey.expiresAt).getTime();
      if (Date.now() >= expiresAt) {
        return c.json({ error: 'Unauthorized', code: 'KEY_EXPIRED' }, 401);
      }
    }

    // Check rate limit
    const rateLimitResult = checkRateLimit(db, apiKey.id, {
      max: apiKey.rateLimitMax,
      windowMs: apiKey.rateLimitWindowMs,
    });

    if (!rateLimitResult.allowed) {
      const retryAfterSec = Math.ceil((rateLimitResult.retryAfter ?? 0) / 1000);
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        { error: 'Too many requests', code: 'RATE_LIMITED', retryAfter: retryAfterSec },
        429,
      );
    }

    // Check budget (if costTracker available and budget is set)
    if (costTracker && apiKey.budgetUsd > 0) {
      const budgetResult = checkBudget(costTracker, apiKey.userId, apiKey.budgetUsd);

      if (!budgetResult.allowed) {
        return c.json(
          { error: 'Budget exceeded', code: 'BUDGET_EXCEEDED', remaining: budgetResult.remaining },
          403,
        );
      }

      // Add budget remaining header when usage is above 80%
      if (budgetResult.remaining < apiKey.budgetUsd * 0.2) {
        c.header('X-Budget-Remaining', budgetResult.remaining.toFixed(4));
      }
    }

    // Attach user context for downstream handlers
    const userContext: UserContext = {
      userId: apiKey.userId,
      apiKeyId: apiKey.id,
      trustLevel: apiKey.trustLevel,
      project: apiKey.project,
    };

    c.set('userContext', userContext);

    return next();
  };
}
