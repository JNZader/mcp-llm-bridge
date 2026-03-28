/**
 * Session Manager for Session Affinity (Sticky Sessions)
 *
 * Feature 6: Ensures multi-turn conversations stick to the same
 * provider/key for consistency. Implements TTL-based session tracking
 * with automatic cleanup.
 */

import { randomUUID } from 'crypto';
import {
  SessionEntry,
  SessionLookup,
  SessionResult,
  SessionConfig,
  SessionStats,
  StickyKey,
  ProviderSessionBreakdown,
  SessionDashboardMetrics,
  DEFAULT_SESSION_CONFIG,
} from './types.js';

/**
 * Manages session affinity for multi-turn conversations.
 * Tracks sessions with TTL-based expiration and provides sticky routing.
 */
export class SessionManager {
  /** Map of sessionId -> SessionEntry */
  private sessions: Map<string, SessionEntry>;
  /** Map of lookupKey -> sessionId (for quick lookup) */
  private lookupIndex: Map<string, string>;
  /** Configuration for this manager instance */
  private config: SessionConfig;
  /** Timer handle for cleanup interval */
  private cleanupTimer?: NodeJS.Timeout;

  /**
   * Creates a new SessionManager instance
   * @param config - Optional partial configuration to override defaults
   */
  constructor(config?: Partial<SessionConfig>) {
    this.sessions = new Map();
    this.lookupIndex = new Map();
    this.config = {
      ...DEFAULT_SESSION_CONFIG,
      ...config,
    };
  }

  /**
   * Get an existing session or create a new one
   * @param lookup - Lookup criteria (apiKeyId, optional provider/model)
   * @param selectedProvider - The provider selected for this session
   * @param selectedKeyId - The specific key ID selected
   * @param selectedModel - The model selected
   * @returns SessionResult with sessionId and isNew flag
   */
  getOrCreateSession(
    lookup: SessionLookup,
    selectedProvider: string,
    selectedKeyId: string,
    selectedModel: string
  ): SessionResult {
    const lookupKey = this.generateLookupKey(lookup);
    const existingSessionId = this.lookupIndex.get(lookupKey);

    // Check if existing session is valid and not expired
    if (existingSessionId) {
      const session = this.sessions.get(existingSessionId);
      if (session && session.expiresAt > Date.now()) {
        // Valid existing session - touch it and return
        this.touchSession(existingSessionId);
        return { sessionId: existingSessionId, isNew: false };
      }
      // Session expired - clean it up
      if (session) {
        this.endSession(existingSessionId);
      }
    }

    // Create new session
    const sessionId = this.generateSessionId();
    const now = Date.now();
    const session: SessionEntry = {
      sessionId,
      apiKeyId: lookup.apiKeyId,
      provider: selectedProvider,
      keyId: selectedKeyId,
      model: selectedModel,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + (this.config.ttlSeconds * 1000),
    };

    this.sessions.set(sessionId, session);
    this.lookupIndex.set(lookupKey, sessionId);

    return { sessionId, isNew: true };
  }

  /**
   * Get a session by its ID
   * @param sessionId - The session identifier
   * @returns The session entry or null if not found/expired
   */
  getSession(sessionId: string): SessionEntry | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check if session has expired
    if (session.expiresAt <= Date.now()) {
      this.endSession(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Update last used timestamp and extend expiration
   * @param sessionId - The session to touch
   */
  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const now = Date.now();
    session.lastUsedAt = now;
    session.expiresAt = now + (this.config.ttlSeconds * 1000);
  }

  /**
   * End a session manually (removes from all tracking)
   * @param sessionId - The session to end
   */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Remove from lookup index
    const lookupKey = this.generateLookupKey({
      apiKeyId: session.apiKeyId,
      provider: session.provider,
      model: session.model,
    });
    this.lookupIndex.delete(lookupKey);

    // Remove from sessions map
    this.sessions.delete(sessionId);
  }

  /**
   * Get sticky routing information for an existing session
   * @param lookup - Lookup criteria
   * @returns StickyKey info or null if no valid session exists
   */
  getStickyKey(lookup: SessionLookup): StickyKey | null {
    const lookupKey = this.generateLookupKey(lookup);
    const sessionId = this.lookupIndex.get(lookupKey);

    if (!sessionId) return null;

    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      // Session expired - clean it up
      if (session) {
        this.endSession(sessionId);
      }
      return null;
    }

    const expiresIn = Math.floor((session.expiresAt - Date.now()) / 1000);

    return {
      provider: session.provider,
      keyId: session.keyId,
      model: session.model,
      expiresIn,
    };
  }

  /**
   * Start automatic cleanup of expired sessions
   */
  startCleanup(): void {
    if (this.cleanupTimer) return; // Already running

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);

    // Ensure cleanup doesn't block process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Manually trigger cleanup of expired sessions
   * @returns Number of expired sessions removed
   */
  cleanup(): number {
    const now = Date.now();
    let removedCount = 0;

    // Find expired sessions
    const expiredSessionIds: string[] = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        expiredSessionIds.push(sessionId);
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessionIds) {
      this.endSession(sessionId);
      removedCount++;
    }

    return removedCount;
  }

  /**
   * Get all active (non-expired) sessions
   * @returns Array of active session entries
   */
  getActiveSessions(): SessionEntry[] {
    const now = Date.now();
    const active: SessionEntry[] = [];

    for (const session of this.sessions.values()) {
      if (session.expiresAt > now) {
        active.push(session);
      }
    }

    return active;
  }

  /**
   * Get session statistics for monitoring
   * @returns SessionStats with counts and averages
   */
  getStats(): SessionStats {
    const now = Date.now();
    let totalSessions = 0;
    let expiredSessions = 0;
    let totalAge = 0;

    for (const session of this.sessions.values()) {
      totalSessions++;
      const age = now - session.createdAt;
      totalAge += age;

      if (session.expiresAt <= now) {
        expiredSessions++;
      }
    }

    const averageSessionAge = totalSessions > 0 ? Math.floor(totalAge / totalSessions) : 0;

    return {
      totalSessions,
      expiredSessions,
      averageSessionAge,
    };
  }

  /**
   * Get dashboard metrics for UI display
   * @returns SessionDashboardMetrics with breakdowns
   */
  getDashboardMetrics(): SessionDashboardMetrics {
    const now = Date.now();
    const activeSessions = this.getActiveSessions();
    const computedAt = now;

    // Calculate average age
    const totalAge = activeSessions.reduce((sum, s) => sum + (now - s.createdAt), 0);
    const averageSessionAge = activeSessions.length > 0
      ? Math.floor(totalAge / activeSessions.length)
      : 0;

    // Group by provider
    const providerMap = new Map<string, { count: number; totalTtl: number }>();
    for (const session of activeSessions) {
      const existing = providerMap.get(session.provider);
      const ttlRemaining = session.expiresAt - now;

      if (existing) {
        existing.count++;
        existing.totalTtl += ttlRemaining;
      } else {
        providerMap.set(session.provider, { count: 1, totalTtl: ttlRemaining });
      }
    }

    const byProvider: ProviderSessionBreakdown[] = Array.from(providerMap.entries()).map(
      ([provider, data]) => ({
        provider,
        sessionCount: data.count,
        avgTtlRemaining: Math.floor(data.totalTtl / data.count / 1000), // in seconds
      })
    );

    return {
      activeSessionCount: activeSessions.length,
      averageSessionAge,
      byProvider,
      computedAt,
    };
  }

  /**
   * Generate a unique session identifier
   * @returns Session ID string
   */
  private generateSessionId(): string {
    return `sess_${randomUUID().replace(/-/g, '')}`;
  }

  /**
   * Generate a lookup key from SessionLookup criteria
   * @param lookup - The lookup criteria
   * @returns Lookup key string
   */
  private generateLookupKey(lookup: SessionLookup): string {
    return `${lookup.apiKeyId}:${lookup.provider || '*'}:${lookup.model || '*'}`;
  }
}
