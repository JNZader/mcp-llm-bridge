/**
 * Quota enforcement — rate limiting and budget checks for API keys.
 *
 * Rate limiting uses a sliding window counter stored in the usage_logs table.
 * Budget checks use the CostTracker's aggregation queries.
 */

import type Database from 'better-sqlite3';
import { CostTracker } from '../core/cost-tracker.js';
import type { RateLimitConfig } from './types.js';

// ── Rate Limiting ────────────────────────────────────────────

/** Result of a rate limit check. */
export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the client can retry (only set when denied). */
  retryAfter?: number;
}

/** Row shape for the count query. */
interface CountRow {
  cnt: number;
  oldest_at: string | null;
}

/**
 * Check whether an API key has exceeded its rate limit.
 *
 * Uses a sliding window: counts requests in usage_logs where
 * `created_at >= now - windowMs` for the given API key prefix.
 *
 * NOTE: This queries usage_logs by a key identifier. Since usage_logs
 * doesn't have an api_key_id column yet, we use the key_name field
 * to correlate (the auth middleware should set key_name to the apiKeyId).
 *
 * @param db - Database instance.
 * @param apiKeyId - The API key ID to check.
 * @param config - Rate limit configuration (max requests, window duration).
 * @returns Whether the request is allowed and optional retry-after hint.
 */
export function checkRateLimit(
  subject: Database.Database | CostTracker,
  apiKeyId: string,
  config: RateLimitConfig,
  identity?: { userId?: string },
): RateLimitResult {
  if (subject instanceof CostTracker) {
    return subject.checkRateLimit({ apiKeyId, userId: identity?.userId }, config);
  }

  // SQLite datetime('now') produces 'YYYY-MM-DD HH:MM:SS' (no T, no Z).
  // We must match that format for string comparison to work.
  const d = new Date(Date.now() - config.windowMs);
  const windowStart = d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  const row = subject
    .prepare<[string, string], CountRow>(
      `SELECT COUNT(*) as cnt, MIN(created_at) as oldest_at
       FROM usage_logs
       WHERE key_name = ? AND created_at >= ?`,
    )
    .get(apiKeyId, windowStart);

  const count = row?.cnt ?? 0;

  if (count >= config.max) {
    // Calculate retry-after based on when the oldest entry in the window expires
    const oldestAt = row?.oldest_at ? new Date(row.oldest_at).getTime() : Date.now();
    const windowEnd = oldestAt + config.windowMs;
    const retryAfter = Math.max(0, windowEnd - Date.now());

    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

// ── Budget Checking ─────────────────────────────────────────

/** Result of a budget check. */
export interface BudgetResult {
  allowed: boolean;
  /** Remaining budget in USD. */
  remaining: number;
}

/**
 * Check whether a user has remaining budget.
 *
 * Queries usage_logs directly by key_name (correlated to apiKeyId by the
 * auth middleware) to get the user's total spend for the current month.
 * When task 7.8 adds a user_id column to usage_logs, this can be switched
 * to filter by user_id instead of key_name.
 *
 * @param costTracker - The CostTracker instance (used for summary queries).
 * @param userId - The user ID to check (used as key_name correlation).
 * @param budgetUsd - The maximum monthly budget in USD. 0 = unlimited.
 * @returns Whether the request is allowed and the remaining budget.
 */
export function checkBudget(
  costTracker: CostTracker,
  identity: { userId?: string; apiKeyId?: string },
  budgetUsd: number,
): BudgetResult {
  // Budget of 0 means unlimited
  if (budgetUsd <= 0) {
    return { allowed: true, remaining: Infinity };
  }

  return costTracker.checkBudget(identity, budgetUsd);
}
