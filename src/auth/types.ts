/**
 * Auth module types — API key management, user context, and quota config.
 *
 * Key format: `mlb_sk_` prefix + 32 random hex characters.
 * Keys are NEVER stored in plaintext — only SHA-256 hashes.
 */

import type { TrustLevel } from '../core/types.js';

/** Prefix for all generated API keys. */
export const API_KEY_PREFIX = 'mlb_sk_';

/** Length of the random hex portion of an API key. */
export const API_KEY_HEX_LENGTH = 32;

/**
 * An API key record as stored in the database.
 * The `keyHash` is the SHA-256 hex digest — the plaintext key is never persisted.
 */
export interface ApiKey {
  id: string;
  keyHash: string;
  keyPrefix: string;
  userId: string;
  project: string | null;
  trustLevel: TrustLevel;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  budgetUsd: number;
  enabled: boolean;
  createdAt: string;
  expiresAt: string | null;
}

/**
 * User context attached to each authenticated request.
 * Set by the auth middleware on `c.set('userContext', ...)`.
 */
export interface UserContext {
  userId: string;
  apiKeyId: string;
  trustLevel: TrustLevel;
  project: string | null;
}

/**
 * Options for creating a new API key.
 */
export interface CreateKeyOpts {
  userId: string;
  project?: string;
  trustLevel?: TrustLevel;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  budgetUsd?: number;
  expiresAt?: string;
}

/**
 * Rate limit configuration for an API key.
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}
