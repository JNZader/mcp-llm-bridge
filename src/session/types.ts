/**
 * TypeScript interfaces for Session Affinity (Sticky Sessions)
 *
 * Feature 6: Session Affinity ensures that multi-turn conversations
 * (like chat) stick to the same provider/key for consistency.
 *
 * Following the specification from openspec/changes/octopus-features
 */

/**
 * Configuration options for SessionManager
 */
export interface SessionConfig {
  /** Time-to-live in seconds (default: 300 = 5 minutes) */
  ttlSeconds: number;
  /** Maximum sessions per API key (default: 100) */
  maxSessionsPerKey: number;
  /** Cleanup interval in milliseconds (default: 60000 = 1 minute) */
  cleanupIntervalMs: number;
}

/**
 * Default session configuration
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  ttlSeconds: 300,
  maxSessionsPerKey: 100,
  cleanupIntervalMs: 60000,
} as const;

/**
 * Individual session entry tracking a conversation session
 */
export interface SessionEntry {
  /** Unique session identifier */
  sessionId: string;
  /** API key ID that owns this session */
  apiKeyId: number;
  /** Provider used for this session (e.g., "openai", "groq") */
  provider: string;
  /** Specific key identifier used */
  keyId: string;
  /** Model used for this session */
  model: string;
  /** Unix timestamp when session was created */
  createdAt: number;
  /** Unix timestamp of last activity */
  lastUsedAt: number;
  /** Unix timestamp when session expires */
  expiresAt: number;
}

/**
 * Lookup criteria for finding or creating sessions
 */
export interface SessionLookup {
  /** API key ID to scope the session */
  apiKeyId: number;
  /** Optional provider filter */
  provider?: string;
  /** Optional model filter */
  model?: string;
}

/**
 * Result from getOrCreateSession operation
 */
export interface SessionResult {
  /** The session ID (existing or new) */
  sessionId: string;
  /** Whether a new session was created */
  isNew: boolean;
}

/**
 * Sticky routing information for router integration
 */
export interface StickyKey {
  /** Provider to use for sticky routing */
  provider: string;
  /** Key ID to use for sticky routing */
  keyId: string;
  /** Model to use for sticky routing */
  model: string;
  /** Seconds remaining until session expires */
  expiresIn: number;
}

/**
 * Session statistics for monitoring
 */
export interface SessionStats {
  /** Total number of active sessions */
  totalSessions: number;
  /** Number of expired sessions */
  expiredSessions: number;
  /** Average session age in milliseconds */
  averageSessionAge: number;
}

/**
 * Session breakdown by provider for monitoring
 */
export interface ProviderSessionBreakdown {
  /** Provider name */
  provider: string;
  /** Number of active sessions for this provider */
  sessionCount: number;
  /** Average TTL remaining for this provider's sessions */
  avgTtlRemaining: number;
}

/**
 * Dashboard session metrics
 */
export interface SessionDashboardMetrics {
  /** Total active sessions */
  activeSessionCount: number;
  /** Average session age in milliseconds */
  averageSessionAge: number;
  /** Sessions grouped by provider */
  byProvider: ProviderSessionBreakdown[];
  /** Timestamp when metrics were computed */
  computedAt: number;
}

// Type guards for runtime type checking

/**
 * Check if a value is a valid SessionEntry
 */
export function isSessionEntry(value: unknown): value is SessionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<SessionEntry>;

  return (
    typeof entry.sessionId === 'string' &&
    typeof entry.apiKeyId === 'number' &&
    typeof entry.provider === 'string' &&
    typeof entry.keyId === 'string' &&
    typeof entry.model === 'string' &&
    typeof entry.createdAt === 'number' &&
    typeof entry.lastUsedAt === 'number' &&
    typeof entry.expiresAt === 'number'
  );
}

/**
 * Check if a value is a valid SessionLookup
 */
export function isSessionLookup(value: unknown): value is SessionLookup {
  if (typeof value !== 'object' || value === null) return false;
  const lookup = value as Partial<SessionLookup>;

  if (typeof lookup.apiKeyId !== 'number') return false;
  if (lookup.provider !== undefined && typeof lookup.provider !== 'string') return false;
  if (lookup.model !== undefined && typeof lookup.model !== 'string') return false;

  return true;
}

/**
 * Check if a value is a valid SessionConfig
 */
export function isSessionConfig(value: unknown): value is SessionConfig {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Partial<SessionConfig>;

  if (config.ttlSeconds !== undefined && typeof config.ttlSeconds !== 'number') return false;
  if (config.maxSessionsPerKey !== undefined && typeof config.maxSessionsPerKey !== 'number') return false;
  if (config.cleanupIntervalMs !== undefined && typeof config.cleanupIntervalMs !== 'number') return false;

  return true;
}
