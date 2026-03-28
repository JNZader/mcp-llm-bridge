/**
 * Session Affinity Module
 *
 * Feature 6: Session Affinity (Sticky Sessions) for multi-turn conversations.
 * Ensures conversations stick to the same provider/key for consistency.
 *
 * @example
 * ```typescript
 * import { SessionManager } from './session/index.js';
 *
 * const manager = new SessionManager({
 *   ttlSeconds: 300,
 *   maxSessionsPerKey: 100,
 *   cleanupIntervalMs: 60000,
 * });
 *
 * // Get or create session
 * const { sessionId, isNew } = manager.getOrCreateSession(
 *   { apiKeyId: 1 },
 *   'openai',
 *   'key1',
 *   'gpt-4o'
 * );
 *
 * // Get sticky routing info
 * const sticky = manager.getStickyKey({ apiKeyId: 1 });
 * if (sticky) {
 *   console.log(`Route to ${sticky.provider} using ${sticky.keyId}`);
 * }
 * ```
 */

// Core class
export { SessionManager } from './session-manager.js';

// Types
export type {
  SessionConfig,
  SessionEntry,
  SessionLookup,
  SessionResult,
  SessionStats,
  StickyKey,
  ProviderSessionBreakdown,
  SessionDashboardMetrics,
} from './types.js';

// Constants and type guards
export {
  DEFAULT_SESSION_CONFIG,
  isSessionEntry,
  isSessionLookup,
  isSessionConfig,
} from './types.js';
