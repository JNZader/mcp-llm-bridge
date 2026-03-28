/**
 * TDD Tests for GroupManager
 *
 * Feature 11: Groups — Unified model names with multi-channel routing
 * Following Red → Green → Refactor cycle
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { GroupManager, createGroupManager } from '../../src/groups/index.js';
import { GROUP_MODE } from '../../src/groups/types.js';
import { SessionManager } from '../../src/session/index.js';

// Test helpers
function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  // Create credentials table (dependency)
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      key_value TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Create groups tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      mode TEXT DEFAULT 'round_robin',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS group_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      model_override TEXT,
      priority INTEGER DEFAULT 0,
      weight INTEGER DEFAULT 1,
      is_active BOOLEAN DEFAULT 1,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES credentials(id) ON DELETE CASCADE,
      UNIQUE(group_id, channel_id)
    );

    CREATE INDEX idx_groups_name ON groups(name);
    CREATE INDEX idx_group_channels_group ON group_channels(group_id);
    CREATE INDEX idx_group_channels_active ON group_channels(is_active);
  `);

  return db;
}

function createTestCredentials(db: Database.Database): { openaiId: number; groqId: number } {
  const stmt = db.prepare('INSERT INTO credentials (provider, key_value) VALUES (?, ?)');
  const openaiResult = stmt.run('openai', 'sk-test-openai');
  const groqResult = stmt.run('groq', 'gsk-test-groq');

  return {
    openaiId: Number(openaiResult.lastInsertRowid),
    groqId: Number(groqResult.lastInsertRowid),
  };
}

describe('GroupManager', () => {
  let db: Database.Database;
  let manager: GroupManager;
  let sessionManager: SessionManager;
  let creds: { openaiId: number; groqId: number };

  beforeEach(() => {
    db = createTestDb();
    sessionManager = new SessionManager();
    manager = createGroupManager(db, sessionManager);
    creds = createTestCredentials(db);
  });

  describe('CRUD Operations', () => {
    it('should create a group', () => {
      const group = manager.createGroup({
        name: 'gpt-4o',
        description: 'Unified GPT-4o access',
        mode: GROUP_MODE.ROUND_ROBIN,
      });

      expect(group.id).toBeGreaterThan(0);
      expect(group.name).toBe('gpt-4o');
      expect(group.description).toBe('Unified GPT-4o access');
      expect(group.mode).toBe('round_robin');
      expect(group.channels).toEqual([]);
      expect(group.createdAt).toBeGreaterThan(0);
      expect(group.updatedAt).toBeGreaterThan(0);
    });

    it('should create a group with default mode', () => {
      const group = manager.createGroup({
        name: 'claude-3-opus',
      });

      expect(group.mode).toBe('round_robin');
    });

    it('should reject empty group name', () => {
      expect(() => manager.createGroup({ name: '' })).toThrow('Group name is required');
      expect(() => manager.createGroup({ name: '   ' })).toThrow('Group name is required');
    });

    it('should reject duplicate group names', () => {
      manager.createGroup({ name: 'gpt-4o' });

      expect(() => manager.createGroup({ name: 'gpt-4o' })).toThrow('already exists');
      // Note: SQLite UNIQUE is case-sensitive, so 'GPT-4O' is different from 'gpt-4o'
      // If you want case-insensitive uniqueness, normalize before saving
      expect(() => manager.createGroup({ name: 'GPT-4O' })).not.toThrow();
    });

    it('should reject invalid mode', () => {
      expect(() =>
        manager.createGroup({ name: 'test', mode: 'invalid' as any })
      ).toThrow('Invalid group mode');
    });

    it('should get a group by id', () => {
      const created = manager.createGroup({ name: 'gpt-4o' });
      const fetched = manager.getGroup(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.name).toBe('gpt-4o');
    });

    it('should return null for non-existent group id', () => {
      const fetched = manager.getGroup(999);
      expect(fetched).toBeNull();
    });

    it('should get a group by name', () => {
      manager.createGroup({ name: 'gpt-4o' });
      const fetched = manager.getGroupByName('gpt-4o');

      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('gpt-4o');
    });

    it('should return null for non-existent group name', () => {
      const fetched = manager.getGroupByName('non-existent');
      expect(fetched).toBeNull();
    });

    it('should update a group', () => {
      const created = manager.createGroup({ name: 'gpt-4o' });

      const updated = manager.updateGroup(created.id, {
        description: 'Updated description',
        mode: GROUP_MODE.WEIGHTED,
      });

      expect(updated.description).toBe('Updated description');
      expect(updated.mode).toBe('weighted');
    });

    it('should update group name', () => {
      const created = manager.createGroup({ name: 'gpt-4o' });

      const updated = manager.updateGroup(created.id, {
        name: 'gpt-4o-latest',
      });

      expect(updated.name).toBe('gpt-4o-latest');
      expect(manager.getGroupByName('gpt-4o')).toBeNull();
      expect(manager.getGroupByName('gpt-4o-latest')).not.toBeNull();
    });

    it('should reject update with duplicate name', () => {
      manager.createGroup({ name: 'gpt-4o' });
      const group2 = manager.createGroup({ name: 'claude-3' });

      expect(() =>
        manager.updateGroup(group2.id, { name: 'gpt-4o' })
      ).toThrow('already exists');
    });

    it('should reject update for non-existent group', () => {
      expect(() =>
        manager.updateGroup(999, { description: 'Test' })
      ).toThrow('not found');
    });

    it('should delete a group', () => {
      const created = manager.createGroup({ name: 'gpt-4o' });
      manager.deleteGroup(created.id);

      expect(manager.getGroup(created.id)).toBeNull();
      expect(manager.getGroupByName('gpt-4o')).toBeNull();
    });

    it('should reject delete for non-existent group', () => {
      expect(() => manager.deleteGroup(999)).toThrow('not found');
    });

    it('should list all groups', () => {
      manager.createGroup({ name: 'gpt-4o' });
      manager.createGroup({ name: 'claude-3' });
      manager.createGroup({ name: 'llama-3' });

      const groups = manager.listGroups();

      expect(groups).toHaveLength(3);
      expect(groups.map(g => g.name).sort()).toEqual(['claude-3', 'gpt-4o', 'llama-3']);
    });

    it('should filter groups by name', () => {
      manager.createGroup({ name: 'gpt-4o' });
      manager.createGroup({ name: 'gpt-4-turbo' });
      manager.createGroup({ name: 'claude-3' });

      const filtered = manager.listGroups({ name: 'gpt' });

      expect(filtered).toHaveLength(2);
      expect(filtered.every(g => g.name.includes('gpt'))).toBe(true);
    });

    it('should filter groups by mode', () => {
      manager.createGroup({ name: 'gpt-4o', mode: GROUP_MODE.ROUND_ROBIN });
      manager.createGroup({ name: 'claude-3', mode: GROUP_MODE.FAILOVER });
      manager.createGroup({ name: 'llama-3', mode: GROUP_MODE.ROUND_ROBIN });

      const filtered = manager.listGroups({ mode: GROUP_MODE.ROUND_ROBIN });

      expect(filtered).toHaveLength(2);
      expect(filtered.every(g => g.mode === 'round_robin')).toBe(true);
    });
  });

  describe('Channel Management', () => {
    it('should add channels to group', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      // Add OpenAI channel
      const channel1 = manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
        priority: 1,
        weight: 3,
      });

      expect(channel1.id).toBeGreaterThan(0);
      expect(channel1.groupId).toBe(group.id);
      expect(channel1.channelId).toBe(creds.openaiId);
      expect(channel1.provider).toBe('openai');
      expect(channel1.priority).toBe(1);
      expect(channel1.weight).toBe(3);
      expect(channel1.isActive).toBe(true);

      // Add Groq channel
      const channel2 = manager.addChannel({
        groupId: group.id,
        channelId: creds.groqId,
        provider: 'groq',
        modelOverride: 'llama-3.1-70b',
        priority: 2,
        weight: 1,
      });

      expect(channel2.provider).toBe('groq');
      expect(channel2.modelOverride).toBe('llama-3.1-70b');

      // Verify channels are loaded with group
      const updated = manager.getGroup(group.id)!;
      expect(updated.channels).toHaveLength(2);
    });

    it('should reject adding channel to non-existent group', () => {
      expect(() =>
        manager.addChannel({
          groupId: 999,
          channelId: creds.openaiId,
          provider: 'openai',
        })
      ).toThrow('not found');
    });

    it('should reject duplicate channel in group', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      expect(() =>
        manager.addChannel({
          groupId: group.id,
          channelId: creds.openaiId,
          provider: 'openai',
        })
      ).toThrow('already in group');
    });

    it('should use default values for channel', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      const channel = manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      expect(channel.priority).toBe(0);
      expect(channel.weight).toBe(1);
      expect(channel.isActive).toBe(true);
    });

    it('should remove channel from group', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      manager.removeChannel(group.id, creds.openaiId);

      const updated = manager.getGroup(group.id)!;
      expect(updated.channels).toHaveLength(0);
    });

    it('should reject removing channel from non-existent group', () => {
      expect(() => manager.removeChannel(999, creds.openaiId)).toThrow('not found');
    });

    it('should update channel configuration', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
        priority: 1,
        weight: 1,
      });

      const updated = manager.updateChannel(group.id, creds.openaiId, {
        modelOverride: 'gpt-4o-2024-08-06',
        priority: 2,
        weight: 5,
        isActive: false,
      });

      expect(updated.modelOverride).toBe('gpt-4o-2024-08-06');
      expect(updated.priority).toBe(2);
      expect(updated.weight).toBe(5);
      expect(updated.isActive).toBe(false);
    });

    it('should reject updating non-existent channel', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      expect(() =>
        manager.updateChannel(group.id, 999, { priority: 1 })
      ).toThrow('not found');
    });
  });

  describe('Routing', () => {
    it('should resolve group by name', () => {
      manager.createGroup({ name: 'gpt-4o' });
      manager.addChannel({
        groupId: 1,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      const group = manager.resolveGroup('gpt-4o');
      expect(group).not.toBeNull();
      expect(group?.name).toBe('gpt-4o');
    });

    it('should return null for non-existent group', () => {
      const group = manager.resolveGroup('non-existent');
      expect(group).toBeNull();
    });

    it('should select channel using round robin', () => {
      const group = manager.createGroup({
        name: 'gpt-4o',
        mode: GROUP_MODE.ROUND_ROBIN,
      });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.groqId,
        provider: 'groq',
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      // First call
      const decision1 = manager.selectChannel(updatedGroup);
      expect(decision1).not.toBeNull();

      // Second call should rotate
      const decision2 = manager.selectChannel(updatedGroup);
      expect(decision2).not.toBeNull();

      // Should alternate between providers
      expect(decision1?.selectedProvider).not.toBe(decision2?.selectedProvider);
    });

    it('should select by priority in failover mode', () => {
      const group = manager.createGroup({
        name: 'gpt-4o',
        mode: GROUP_MODE.FAILOVER,
      });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
        priority: 1, // Higher priority (lower number)
      });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.groqId,
        provider: 'groq',
        priority: 2, // Lower priority
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      const decision = manager.selectChannel(updatedGroup);
      expect(decision?.selectedProvider).toBe('openai');
    });

    it('should return null when no active channels', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
        isActive: false,
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      const decision = manager.selectChannel(updatedGroup);
      expect(decision).toBeNull();
    });

    it('should skip inactive channels', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
        isActive: false,
      });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.groqId,
        provider: 'groq',
        isActive: true,
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      const decision = manager.selectChannel(updatedGroup);
      expect(decision?.selectedProvider).toBe('groq');
    });

    it('should use sticky session if available', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      // Create session first
      const { sessionId } = sessionManager.getOrCreateSession(
        { apiKeyId: 123 },
        'openai',
        creds.openaiId.toString(),
        'gpt-4o'
      );

      const decision = manager.selectChannel(updatedGroup, {
        apiKeyId: 123,
        sessionId: sessionId,
      });

      expect(decision?.routingMode).toBe('sticky');
      expect(decision?.selectedProvider).toBe('openai');
    });

    it('should use model override if configured', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.groqId,
        provider: 'groq',
        modelOverride: 'llama-3.1-70b-versatile',
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      const decision = manager.selectChannel(updatedGroup);
      expect(decision?.actualModel).toBe('llama-3.1-70b-versatile');
    });

    it('should use group name when no model override', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      const decision = manager.selectChannel(updatedGroup);
      expect(decision?.actualModel).toBe('gpt-4o');
    });

    it('should include routing metadata in decision', () => {
      const group = manager.createGroup({
        name: 'gpt-4o',
        mode: GROUP_MODE.RANDOM,
      });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      const decision = manager.selectChannel(updatedGroup);

      expect(decision?.groupName).toBe('gpt-4o');
      expect(decision?.selectedProvider).toBe('openai');
      expect(decision?.selectedChannelId).toBe(creds.openaiId);
      expect(decision?.routingMode).toBe('random');
      expect(decision?.attempt).toBe(1);
    });
  });

  describe('Cache', () => {
    it('should cache groups for fast lookup', () => {
      manager.createGroup({ name: 'gpt-4o' });

      // First lookup populates cache
      manager.resolveGroup('gpt-4o');

      // Check cache stats
      const stats = manager.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.keys).toContain('gpt-4o');
    });

    it('should invalidate cache on update', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });
      manager.resolveGroup('gpt-4o'); // Populate cache

      expect(manager.getCacheStats().size).toBe(1);

      manager.updateGroup(group.id, { description: 'Updated' });

      // Cache should be invalidated
      expect(manager.getCacheStats().size).toBe(0);
    });

    it('should invalidate cache on delete', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });
      manager.resolveGroup('gpt-4o'); // Populate cache

      expect(manager.getCacheStats().size).toBe(1);

      manager.deleteGroup(group.id);

      // Cache should be invalidated
      expect(manager.getCacheStats().size).toBe(0);
    });

    it('should manually refresh cache', () => {
      // Create groups
      manager.createGroup({ name: 'gpt-4o' });
      manager.createGroup({ name: 'claude-3' });

      // Clear cache
      manager.invalidateCache();
      expect(manager.getCacheStats().size).toBe(0);

      // Refresh
      manager.refreshCache();
      expect(manager.getCacheStats().size).toBe(2);
    });

    it('should manually invalidate specific group cache', () => {
      manager.createGroup({ name: 'gpt-4o' });
      manager.createGroup({ name: 'claude-3' });

      manager.refreshCache();
      expect(manager.getCacheStats().size).toBe(2);

      manager.invalidateCache('gpt-4o');
      const stats = manager.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).not.toContain('gpt-4o');
      expect(stats.keys).toContain('claude-3');
    });
  });

  describe('Statistics', () => {
    it('should track group stats', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      const stats = manager.getGroupStats(group.id);

      expect(stats.totalRequests).toBe(0);
      expect(stats.channelDistribution).toHaveProperty('openai');
    });

    it('should update stats on selection', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      // Make selections
      manager.selectChannel(updatedGroup);
      manager.selectChannel(updatedGroup);
      manager.selectChannel(updatedGroup);

      const stats = manager.getGroupStats(group.id);
      expect(stats.totalRequests).toBe(3);
    });

    it('should reject stats for non-existent group', () => {
      expect(() => manager.getGroupStats(999)).toThrow('not found');
    });

    it('should reset stats', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      // Reload group to get channels
      const updatedGroup = manager.getGroup(group.id)!;

      manager.selectChannel(updatedGroup);
      expect(manager.getGroupStats(group.id).totalRequests).toBe(1);

      manager.resetStats(group.id);
      expect(manager.getGroupStats(group.id).totalRequests).toBe(0);
    });

    it('should reset all stats when no group specified', () => {
      const group1 = manager.createGroup({ name: 'gpt-4o' });
      const group2 = manager.createGroup({ name: 'claude-3' });

      manager.addChannel({ groupId: group1.id, channelId: creds.openaiId, provider: 'openai' });
      manager.addChannel({ groupId: group2.id, channelId: creds.groqId, provider: 'groq' });

      // Reload groups to get channels
      const updatedGroup1 = manager.getGroup(group1.id)!;
      const updatedGroup2 = manager.getGroup(group2.id)!;

      manager.selectChannel(updatedGroup1);
      manager.selectChannel(updatedGroup2);

      manager.resetStats();

      expect(manager.getGroupStats(group1.id).totalRequests).toBe(0);
      expect(manager.getGroupStats(group2.id).totalRequests).toBe(0);
    });
  });

  describe('Type Guards', () => {
    it('should validate group mode', async () => {
      const { isGroupMode } = await import('../../src/groups/types.js');

      expect(isGroupMode('round_robin')).toBe(true);
      expect(isGroupMode('random')).toBe(true);
      expect(isGroupMode('failover')).toBe(true);
      expect(isGroupMode('weighted')).toBe(true);
      expect(isGroupMode('invalid')).toBe(false);
      expect(isGroupMode(null)).toBe(false);
      expect(isGroupMode(undefined)).toBe(false);
    });

    it('should validate create group input', async () => {
      const { isCreateGroupInput } = await import('../../src/groups/types.js');

      expect(isCreateGroupInput({ name: 'gpt-4o' })).toBe(true);
      expect(isCreateGroupInput({ name: 'gpt-4o', mode: 'round_robin' })).toBe(true);
      expect(isCreateGroupInput({ name: 'gpt-4o', description: 'Test' })).toBe(true);
      expect(isCreateGroupInput({})).toBe(false);
      expect(isCreateGroupInput({ name: 123 })).toBe(false);
      expect(isCreateGroupInput(null)).toBe(false);
    });

    it('should validate add channel input', async () => {
      const { isAddChannelToGroupInput } = await import('../../src/groups/types.js');

      expect(isAddChannelToGroupInput({
        groupId: 1,
        channelId: 2,
        provider: 'openai',
      })).toBe(true);

      expect(isAddChannelToGroupInput({
        groupId: 1,
        channelId: 2,
        provider: 'openai',
        modelOverride: 'gpt-4',
        priority: 1,
        weight: 2,
      })).toBe(true);

      expect(isAddChannelToGroupInput({})).toBe(false);
      expect(isAddChannelToGroupInput({ groupId: '1', channelId: 2, provider: 'openai' })).toBe(false);
    });
  });
});
