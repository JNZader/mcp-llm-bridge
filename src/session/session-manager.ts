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
  KindSessionBreakdown,
  SessionDashboardMetrics,
  DEFAULT_SESSION_CONFIG,
  SESSION_ENTRY_KIND,
  type ApiGroupSessionEntry,
  type RouterStickySessionEntry,
} from './types.js';

/**
 * Manages session affinity for multi-turn conversations.
 * Tracks sessions with TTL-based expiration and provides sticky routing.
 */
export class SessionManager {
  /** Map of sessionId -> SessionEntry */
  private sessionsById: Map<string, SessionEntry>;
  /** Map of api/group lookupKey -> sessionId */
  private apiLookupIndex: Map<string, string>;
  /** Map of router sticky lookupKey -> sessionId */
  private routerLookupIndex: Map<string, string>;
  /** Configuration for this manager instance */
  private config: SessionConfig;
  /** Timer handle for cleanup interval */
  private cleanupTimer?: NodeJS.Timeout;

  /**
   * Creates a new SessionManager instance
   * @param config - Optional partial configuration to override defaults
   */
  constructor(config?: Partial<SessionConfig>) {
    this.sessionsById = new Map();
    this.apiLookupIndex = new Map();
    this.routerLookupIndex = new Map();
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
    const lookupKey = this.generateApiLookupKey(lookup);
    const existingSessionId = this.apiLookupIndex.get(lookupKey);

    // Check if existing session is valid and not expired
    if (existingSessionId) {
      const session = this.sessionsById.get(existingSessionId);
      if (session?.kind === SESSION_ENTRY_KIND.API_GROUP && session.expiresAt > Date.now()) {
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
    const ttlMs = this.config.ttlSeconds * 1000;
    const session: ApiGroupSessionEntry = {
      sessionId,
      kind: SESSION_ENTRY_KIND.API_GROUP,
      apiKeyId: lookup.apiKeyId,
      provider: selectedProvider,
      keyId: selectedKeyId,
      model: selectedModel,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
    };

    this.sessionsById.set(sessionId, session);
    this.apiLookupIndex.set(lookupKey, sessionId);

    return { sessionId, isNew: true };
  }

  /**
   * Get a session by its ID
   * @param sessionId - The session identifier
   * @returns The session entry or null if not found/expired
   */
  getSession(sessionId: string): SessionEntry | null {
    const session = this.sessionsById.get(sessionId);
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
    const session = this.sessionsById.get(sessionId);
    if (!session) return;

    const now = Date.now();
    session.lastUsedAt = now;
    session.expiresAt = now + session.ttlMs;
  }

  /**
   * End a session manually (removes from all tracking)
   * @param sessionId - The session to end
   */
  endSession(sessionId: string): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) return;

    if (session.kind === SESSION_ENTRY_KIND.API_GROUP) {
      const lookupKey = this.generateApiLookupKey({
        apiKeyId: session.apiKeyId,
        provider: session.provider,
        model: session.model,
      });
      this.apiLookupIndex.delete(lookupKey);
    } else {
      const lookupKey = this.generateRouterLookupKey(session.clientId, session.model);
      this.routerLookupIndex.delete(lookupKey);
    }

    // Remove from sessions map
    this.sessionsById.delete(sessionId);
  }

  /**
   * Get sticky routing information for an existing session
   * @param lookup - Lookup criteria
   * @returns StickyKey info or null if no valid session exists
   */
  getStickyKey(lookup: SessionLookup): StickyKey | null {
    const lookupKey = this.generateApiLookupKey(lookup);
    const sessionId = this.apiLookupIndex.get(lookupKey);

    return this.getStickyKeyBySessionId(sessionId, SESSION_ENTRY_KIND.API_GROUP);
  }

  getRouterStickySession(clientId: string, model: string): StickyKey | null {
    const sessionId = this.routerLookupIndex.get(this.generateRouterLookupKey(clientId, model));

    return this.getStickyKeyBySessionId(sessionId, SESSION_ENTRY_KIND.ROUTER_STICKY);
  }

  pinRouterStickySession(
    clientId: string,
    model: string,
    provider: string,
    keyId: string,
    ttlMs: number,
  ): void {
    const lookupKey = this.generateRouterLookupKey(clientId, model);
    const existingSessionId = this.routerLookupIndex.get(lookupKey);
    const now = Date.now();

    if (existingSessionId) {
      const existingSession = this.sessionsById.get(existingSessionId);
      if (existingSession?.kind === SESSION_ENTRY_KIND.ROUTER_STICKY && existingSession.expiresAt > now) {
        existingSession.provider = provider;
        existingSession.keyId = keyId;
        existingSession.lastUsedAt = now;
        existingSession.expiresAt = now + ttlMs;
        existingSession.ttlMs = ttlMs;
        return;
      }

      if (existingSession) {
        this.endSession(existingSessionId);
      }
    }

    const sessionId = this.generateSessionId();
    const session: RouterStickySessionEntry = {
      sessionId,
      kind: SESSION_ENTRY_KIND.ROUTER_STICKY,
      clientId,
      provider,
      keyId,
      model,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
    };

    this.sessionsById.set(sessionId, session);
    this.routerLookupIndex.set(lookupKey, sessionId);
  }

  unpinRouterStickySession(clientId: string, model: string): void {
    const sessionId = this.routerLookupIndex.get(this.generateRouterLookupKey(clientId, model));

    if (!sessionId) return;

    this.endSession(sessionId);
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
    for (const [sessionId, session] of this.sessionsById.entries()) {
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

    for (const session of this.sessionsById.values()) {
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
    const kindMap = new Map<string, { totalSessions: number; expiredSessions: number; totalAge: number }>();

    for (const session of this.sessionsById.values()) {
      totalSessions++;
      const age = now - session.createdAt;
      totalAge += age;
      const kindStats = kindMap.get(session.kind) ?? { totalSessions: 0, expiredSessions: 0, totalAge: 0 };
      kindStats.totalSessions++;
      kindStats.totalAge += age;

      if (session.expiresAt <= now) {
        expiredSessions++;
        kindStats.expiredSessions++;
      }

      kindMap.set(session.kind, kindStats);
    }

    const averageSessionAge = totalSessions > 0 ? Math.floor(totalAge / totalSessions) : 0;
    const byKind = Array.from(kindMap.entries()).map(([kind, stats]) => ({
      kind: kind as SessionEntry['kind'],
      totalSessions: stats.totalSessions,
      expiredSessions: stats.expiredSessions,
      averageSessionAge: Math.floor(stats.totalAge / stats.totalSessions),
    }));

    return {
      totalSessions,
      expiredSessions,
      averageSessionAge,
      byKind,
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

    const kindMap = new Map<string, { count: number; totalAge: number }>();
    for (const session of activeSessions) {
      const existing = kindMap.get(session.kind);
      const age = now - session.createdAt;

      if (existing) {
        existing.count++;
        existing.totalAge += age;
      } else {
        kindMap.set(session.kind, { count: 1, totalAge: age });
      }
    }

    const byKind: KindSessionBreakdown[] = Array.from(kindMap.entries()).map(([kind, data]) => ({
      kind: kind as KindSessionBreakdown['kind'],
      sessionCount: data.count,
      averageSessionAge: Math.floor(data.totalAge / data.count),
    }));

    // Group by provider
    const providerMap = new Map<string, { kind: SessionEntry['kind']; provider: string; count: number; totalTtl: number }>();
    for (const session of activeSessions) {
      const providerKey = `${session.kind}:${session.provider}`;
      const existing = providerMap.get(providerKey);
      const ttlRemaining = session.expiresAt - now;

      if (existing) {
        existing.count++;
        existing.totalTtl += ttlRemaining;
      } else {
        providerMap.set(providerKey, {
          kind: session.kind,
          provider: session.provider,
          count: 1,
          totalTtl: ttlRemaining,
        });
      }
    }

    const byProvider: ProviderSessionBreakdown[] = Array.from(providerMap.entries()).map(
      ([, data]) => ({
        kind: data.kind,
        provider: data.provider,
        sessionCount: data.count,
        avgTtlRemaining: Math.floor(data.totalTtl / data.count / 1000), // in seconds
      })
    );

    return {
      activeSessionCount: activeSessions.length,
      averageSessionAge,
      byKind,
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
  private generateApiLookupKey(lookup: SessionLookup): string {
    return `${lookup.apiKeyId}:${lookup.provider || '*'}:${lookup.model || '*'}`;
  }

  private generateRouterLookupKey(clientId: string, model: string): string {
    return `${clientId}:${model}`;
  }

  private getStickyKeyBySessionId(
    sessionId: string | undefined,
    expectedKind: SessionEntry['kind'],
  ): StickyKey | null {
    if (!sessionId) return null;

    const session = this.sessionsById.get(sessionId);
    if (!session || session.kind !== expectedKind || session.expiresAt <= Date.now()) {
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
}
