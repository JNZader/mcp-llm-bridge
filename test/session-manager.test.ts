/**
 * SessionManager tests — session affinity, TTL expiry, sticky routing, cleanup.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SessionManager } from '../src/session/session-manager.js';
import type { SessionDashboardMetrics } from '../src/session/types.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      ttlSeconds: 2,
      cleanupIntervalMs: 1000,
      maxSessionsPerKey: 3,
    });
  });

  afterEach(() => {
    manager.stopCleanup();
  });

  // ── getOrCreateSession ─────────────────────────────────

  it('creates a new session', () => {
    const result = manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    assert.ok(result.sessionId.startsWith('sess_'), 'sessionId should start with sess_');
    assert.equal(result.isNew, true);
  });

  it('returns existing session for same lookup', () => {
    const first = manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    const second = manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.isNew, false);
  });

  it('creates different sessions for different apiKeyIds', () => {
    const a = manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    const b = manager.getOrCreateSession(
      { apiKeyId: 2 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    assert.notEqual(a.sessionId, b.sessionId);
    assert.equal(a.isNew, true);
    assert.equal(b.isNew, true);
  });

  it('creates different sessions for different providers', () => {
    const a = manager.getOrCreateSession(
      { apiKeyId: 1, provider: 'openai' },
      'openai',
      'key-1',
      'gpt-4o'
    );

    const b = manager.getOrCreateSession(
      { apiKeyId: 1, provider: 'anthropic' },
      'anthropic',
      'key-2',
      'claude-3'
    );

    assert.notEqual(a.sessionId, b.sessionId);
  });

  // ── TTL Expiry ─────────────────────────────────────────

  it('expires session after TTL', async () => {
    const shortTtlManager = new SessionManager({ ttlSeconds: 0 });

    const result = shortTtlManager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 50));

    const session = shortTtlManager.getSession(result.sessionId);
    assert.equal(session, null, 'session should be expired');

    shortTtlManager.stopCleanup();
  });

  it('getOrCreateSession replaces expired session', async () => {
    const shortTtlManager = new SessionManager({ ttlSeconds: 0 });

    const first = shortTtlManager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = shortTtlManager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(second.isNew, true);

    shortTtlManager.stopCleanup();
  });

  // ── getStickyKey ─────────────────────────────────────

  it('returns sticky key for active session', () => {
    manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    const sticky = manager.getStickyKey({ apiKeyId: 1 });

    assert.ok(sticky);
    assert.equal(sticky!.provider, 'openai');
    assert.equal(sticky!.keyId, 'key-1');
    assert.equal(sticky!.model, 'gpt-4o');
    assert.ok(sticky!.expiresIn > 0);
    assert.ok(sticky!.expiresIn <= 2);
  });

  it('returns null for unknown sticky key', () => {
    const sticky = manager.getStickyKey({ apiKeyId: 999 });
    assert.equal(sticky, null);
  });

  it('returns null for expired sticky key', async () => {
    const shortTtlManager = new SessionManager({ ttlSeconds: 0 });

    shortTtlManager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const sticky = shortTtlManager.getStickyKey({ apiKeyId: 1 });
    assert.equal(sticky, null);

    shortTtlManager.stopCleanup();
  });

  // ── Cleanup ────────────────────────────────────────────

  it('cleanup removes expired sessions', async () => {
    const shortTtlManager = new SessionManager({ ttlSeconds: 0 });

    shortTtlManager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const removed = shortTtlManager.cleanup();
    assert.equal(removed, 1);
    assert.equal(shortTtlManager.getActiveSessions().length, 0);

    shortTtlManager.stopCleanup();
  });

  it('cleanup returns 0 when no expired sessions', () => {
    manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    const removed = manager.cleanup();
    assert.equal(removed, 0);
  });

  it('startCleanup and stopCleanup manage interval', () => {
    manager.startCleanup();
    // Should not throw if already started
    manager.startCleanup();
    manager.stopCleanup();
    // Should not throw if already stopped
    manager.stopCleanup();
  });

  // ── getStats ───────────────────────────────────────────

  it('getStats reflects total and expired sessions', async () => {
    const shortTtlManager = new SessionManager({ ttlSeconds: 1 });

    shortTtlManager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    // Before expiry
    let stats = shortTtlManager.getStats();
    assert.equal(stats.totalSessions, 1);
    assert.equal(stats.expiredSessions, 0);

    // After expiry
    await new Promise((resolve) => setTimeout(resolve, 1100));
    stats = shortTtlManager.getStats();
    assert.equal(stats.totalSessions, 1);
    assert.equal(stats.expiredSessions, 1);
    assert.ok(stats.averageSessionAge > 0);

    shortTtlManager.stopCleanup();
  });

  it('getStats returns zeros for empty manager', () => {
    const stats = manager.getStats();
    assert.equal(stats.totalSessions, 0);
    assert.equal(stats.expiredSessions, 0);
    assert.equal(stats.averageSessionAge, 0);
  });

  // ── getDashboardMetrics ────────────────────────────────

  it('getDashboardMetrics returns active sessions breakdown', () => {
    manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    manager.getOrCreateSession(
      { apiKeyId: 2 },
      'anthropic',
      'key-2',
      'claude-3'
    );

    const metrics: SessionDashboardMetrics = manager.getDashboardMetrics();

    assert.equal(metrics.activeSessionCount, 2);
    assert.ok(metrics.averageSessionAge >= 0);
    assert.ok(metrics.computedAt > 0);
    assert.equal(metrics.byProvider.length, 2);

    const openaiEntry = metrics.byProvider.find((p) => p.provider === 'openai');
    assert.ok(openaiEntry);
    assert.equal(openaiEntry!.sessionCount, 1);
    assert.ok(openaiEntry!.avgTtlRemaining > 0);
    assert.ok(openaiEntry!.avgTtlRemaining <= 2);
  });

  it('getDashboardMetrics returns empty state', () => {
    const metrics = manager.getDashboardMetrics();
    assert.equal(metrics.activeSessionCount, 0);
    assert.equal(metrics.averageSessionAge, 0);
    assert.equal(metrics.byProvider.length, 0);
    assert.ok(metrics.computedAt > 0);
  });

  // ── maxSessionsPerKey ──────────────────────────────────

  it('maxSessionsPerKey is NOT currently enforced (documented behavior)', () => {
    const limitedManager = new SessionManager({
      ttlSeconds: 60,
      maxSessionsPerKey: 2,
    });

    // Create 3 sessions for the same apiKeyId — should NOT throw or reject
    const a = limitedManager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-a',
      'gpt-4o'
    );
    const b = limitedManager.getOrCreateSession(
      { apiKeyId: 1, provider: 'anthropic' },
      'anthropic',
      'key-b',
      'claude-3'
    );
    const c = limitedManager.getOrCreateSession(
      { apiKeyId: 1, provider: 'groq' },
      'groq',
      'key-c',
      'llama-3'
    );

    assert.equal(a.isNew, true);
    assert.equal(b.isNew, true);
    assert.equal(c.isNew, true);

    // All three exist despite maxSessionsPerKey=2
    assert.equal(limitedManager.getActiveSessions().length, 3);

    limitedManager.stopCleanup();
  });

  // ── getSession / touchSession ──────────────────────────

  it('getSession returns active session', () => {
    const result = manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    const session = manager.getSession(result.sessionId);
    assert.ok(session);
    assert.equal(session!.sessionId, result.sessionId);
    assert.equal(session!.provider, 'openai');
  });

  it('getSession returns null for unknown session', () => {
    const session = manager.getSession('sess_nonexistent');
    assert.equal(session, null);
  });

  it('touchSession extends expiry', async () => {
    const result = manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    const beforeTouch = manager.getSession(result.sessionId)!.expiresAt;

    await new Promise((resolve) => setTimeout(resolve, 100));

    manager.touchSession(result.sessionId);

    const afterTouch = manager.getSession(result.sessionId)!.expiresAt;
    assert.ok(afterTouch > beforeTouch, 'touchSession should extend expiry');
  });

  // ── endSession ─────────────────────────────────────────

  it('endSession removes session manually', () => {
    const result = manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    assert.equal(manager.getSession(result.sessionId) !== null, true);

    manager.endSession(result.sessionId);

    assert.equal(manager.getSession(result.sessionId), null);
    assert.equal(manager.getStickyKey({ apiKeyId: 1 }), null);
  });

  it('endSession is idempotent for unknown session', () => {
    assert.doesNotThrow(() => {
      manager.endSession('sess_nonexistent');
    });
  });

  // ── getActiveSessions ──────────────────────────────────

  it('getActiveSessions excludes expired sessions', async () => {
    const shortTtlManager = new SessionManager({ ttlSeconds: 0 });

    shortTtlManager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const active = shortTtlManager.getActiveSessions();
    assert.equal(active.length, 0);

    shortTtlManager.stopCleanup();
  });

  it('getActiveSessions returns only active sessions', () => {
    manager.getOrCreateSession(
      { apiKeyId: 1 },
      'openai',
      'key-1',
      'gpt-4o'
    );

    const active = manager.getActiveSessions();
    assert.equal(active.length, 1);
    assert.equal(active[0]!.apiKeyId, 1);
  });
});
