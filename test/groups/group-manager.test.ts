/**
 * TDD Tests for GroupManager
 *
 * Feature 11: Groups — Unified model names with multi-channel routing
 * Following Red → Green → Refactor cycle
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
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

      assert.ok(group.id > 0);
      assert.strictEqual(group.name, 'gpt-4o');
      assert.strictEqual(group.description, 'Unified GPT-4o access');
      assert.strictEqual(group.mode, 'round_robin');
      assert.deepStrictEqual(group.channels, []);
      assert.ok(group.createdAt > 0);
      assert.ok(group.updatedAt > 0);
    });

    it('should create a group with default mode', () => {
      const group = manager.createGroup({
        name: 'claude-3-opus',
      });

      assert.strictEqual(group.mode, 'round_robin');
    });

    it('should reject empty group name', () => {
      assert.throws(() => manager.createGroup({ name: '' }), /Group name is required/);
      assert.throws(() => manager.createGroup({ name: '   ' }), /Group name is required/);
    });

    it('should reject duplicate group names', () => {
      manager.createGroup({ name: 'gpt-4o' });

      assert.throws(() => manager.createGroup({ name: 'gpt-4o' }), /already exists/);
      // Note: SQLite UNIQUE is case-sensitive, so 'GPT-4O' is different from 'gpt-4o'
      // If you want case-insensitive uniqueness, normalize before saving
      assert.doesNotThrow(() => manager.createGroup({ name: 'GPT-4O' }));
    });

    it('should reject invalid mode', () => {
      assert.throws(() =>
        manager.createGroup({ name: 'test', mode: 'invalid' as any }),
        /Invalid group mode/
      );
    });

    it('should get a group by id', () => {
      const created = manager.createGroup({ name: 'gpt-4o' });
      const fetched = manager.getGroup(created.id);

      assert.notStrictEqual(fetched, null);
      assert.strictEqual(fetched?.id, created.id);
      assert.strictEqual(fetched?.name, 'gpt-4o');
    });

    it('should return null for non-existent group id', () => {
      const fetched = manager.getGroup(999);
      assert.strictEqual(fetched, null);
    });

    it('should get a group by name', () => {
      manager.createGroup({ name: 'gpt-4o' });
      const fetched = manager.getGroupByName('gpt-4o');

      assert.notStrictEqual(fetched, null);
      assert.strictEqual(fetched?.name, 'gpt-4o');
    });

    it('should return null for non-existent group name', () => {
      const fetched = manager.getGroupByName('non-existent');
      assert.strictEqual(fetched, null);
    });

    it('should update a group', () => {
      const created = manager.createGroup({ name: 'gpt-4o' });

      const updated = manager.updateGroup(created.id, {
        description: 'Updated description',
        mode: GROUP_MODE.WEIGHTED,
      });

      assert.strictEqual(updated.description, 'Updated description');
      assert.strictEqual(updated.mode, 'weighted');
    });

    it('should update group name', () => {
      const created = manager.createGroup({ name: 'gpt-4o' });

      const updated = manager.updateGroup(created.id, {
        name: 'gpt-4o-latest',
      });

      assert.strictEqual(updated.name, 'gpt-4o-latest');
      assert.strictEqual(manager.getGroupByName('gpt-4o'), null);
      assert.notStrictEqual(manager.getGroupByName('gpt-4o-latest'), null);
    });

    it('should reject update with duplicate name', () => {
      manager.createGroup({ name: 'gpt-4o' });
      const group2 = manager.createGroup({ name: 'claude-3' });

      assert.throws(() =>
        manager.updateGroup(group2.id, { name: 'gpt-4o' }),
        /already exists/
      );
    });

    it('should reject update for non-existent group', () => {
      assert.throws(() =>
        manager.updateGroup(999, { description: 'Test' }),
        /not found/
      );
    });

    it('should delete a group', () => {
      const created = manager.createGroup({ name: 'gpt-4o' });
      manager.deleteGroup(created.id);

      assert.strictEqual(manager.getGroup(created.id), null);
      assert.strictEqual(manager.getGroupByName('gpt-4o'), null);
    });

    it('should reject delete for non-existent group', () => {
      assert.throws(() => manager.deleteGroup(999), /not found/);
    });

    it('should list all groups', () => {
      manager.createGroup({ name: 'gpt-4o' });
      manager.createGroup({ name: 'claude-3' });
      manager.createGroup({ name: 'llama-3' });

      const groups = manager.listGroups();

      assert.strictEqual(groups.length, 3);
      assert.deepStrictEqual(groups.map(g => g.name).sort(), ['claude-3', 'gpt-4o', 'llama-3'])
    });

    it('should filter groups by name', () => {
      manager.createGroup({ name: 'gpt-4o' });
      manager.createGroup({ name: 'gpt-4-turbo' });
      manager.createGroup({ name: 'claude-3' });

      const filtered = manager.listGroups({ name: 'gpt' });

      assert.strictEqual(filtered.length, 2);
assert.strictEqual(filtered.every(g => g.name.includes("gpt")), true);
    });

    it('should filter groups by mode', () => {
      manager.createGroup({ name: 'gpt-4o', mode: GROUP_MODE.ROUND_ROBIN });
      manager.createGroup({ name: 'claude-3', mode: GROUP_MODE.FAILOVER });
      manager.createGroup({ name: 'llama-3', mode: GROUP_MODE.ROUND_ROBIN });

      const filtered = manager.listGroups({ mode: GROUP_MODE.ROUND_ROBIN });

      assert.strictEqual(filtered.length, 2);
assert.strictEqual(filtered.every(g => g.mode === "round_robin"), true);
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

      assert.ok(channel1.id > 0);
      assert.strictEqual(channel1.groupId, group.id);
      assert.strictEqual(channel1.channelId, creds.openaiId);
      assert.strictEqual(channel1.provider, 'openai');
      assert.strictEqual(channel1.priority, 1);
      assert.strictEqual(channel1.weight, 3);
      assert.strictEqual(channel1.isActive, true);

      // Add Groq channel
      const channel2 = manager.addChannel({
        groupId: group.id,
        channelId: creds.groqId,
        provider: 'groq',
        modelOverride: 'llama-3.1-70b',
        priority: 2,
        weight: 1,
      });

      assert.strictEqual(channel2.provider, 'groq');
      assert.strictEqual(channel2.modelOverride, 'llama-3.1-70b');

      // Verify channels are loaded with group
      const updated = manager.getGroup(group.id)!;
      assert.strictEqual(updated.channels.length, 2);
    });

    it('should reject adding channel to non-existent group', () => {
      assert.throws(() =>
        manager.addChannel({
          groupId: 999,
          channelId: creds.openaiId,
          provider: 'openai',
        }),
        /not found/
      );
    });

    it('should reject duplicate channel in group', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      assert.throws(() =>
        manager.addChannel({
          groupId: group.id,
          channelId: creds.openaiId,
          provider: 'openai',
        }),
        /already in group/
      );
    });

    it('should use default values for channel', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      const channel = manager.addChannel({
        groupId: group.id,
        channelId: creds.openaiId,
        provider: 'openai',
      });

      assert.strictEqual(channel.priority, 0);
      assert.strictEqual(channel.weight, 1);
      assert.strictEqual(channel.isActive, true);
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
      assert.strictEqual(updated.channels.length, 0);
    });

    it('should reject removing channel from non-existent group', () => {
assert.throws(() => manager.removeChannel(999, creds.openaiId), /not found/);
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

      assert.strictEqual(updated.modelOverride, 'gpt-4o-2024-08-06');
      assert.strictEqual(updated.priority, 2);
      assert.strictEqual(updated.weight, 5);
      assert.strictEqual(updated.isActive, false);
    });

    it('should reject updating non-existent channel', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });

      assert.throws(() =>
        manager.updateChannel(group.id, 999, { priority: 1 }),
        /not found/
      );
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
      assert.notStrictEqual(group, null);
      assert.strictEqual(group?.name, 'gpt-4o');
    });

    it('should return null for non-existent group', () => {
      const group = manager.resolveGroup('non-existent');
      assert.strictEqual(group, null);
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
      assert.notStrictEqual(decision1, null);

      // Second call should rotate
      const decision2 = manager.selectChannel(updatedGroup);
      assert.notStrictEqual(decision2, null);

      // Should alternate between providers
      assert.notStrictEqual(decision1?.selectedProvider, decision2?.selectedProvider);
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
      assert.strictEqual(decision?.selectedProvider, 'openai');
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
      assert.strictEqual(decision, null);
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
      assert.strictEqual(decision?.selectedProvider, 'groq');
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

      assert.strictEqual(decision?.routingMode, 'sticky');
      assert.strictEqual(decision?.selectedProvider, 'openai');
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
      assert.strictEqual(decision?.actualModel, 'llama-3.1-70b-versatile');
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
      assert.strictEqual(decision?.actualModel, 'gpt-4o');
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

      assert.strictEqual(decision?.groupName, 'gpt-4o');
      assert.strictEqual(decision?.selectedProvider, 'openai');
      assert.strictEqual(decision?.selectedChannelId, creds.openaiId);
      assert.strictEqual(decision?.routingMode, 'random');
      assert.strictEqual(decision?.attempt, 1);
    });
  });

  describe('Cache', () => {
    it('should cache groups for fast lookup', () => {
      manager.createGroup({ name: 'gpt-4o' });

      // First lookup populates cache
      manager.resolveGroup('gpt-4o');

      // Check cache stats
      const stats = manager.getCacheStats();
      assert.ok(stats.size > 0);
      assert.ok(stats.keys.includes('gpt-4o'));
    });

    it('should invalidate cache on update', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });
      manager.resolveGroup('gpt-4o'); // Populate cache

assert.strictEqual(manager.getCacheStats().size, 1);

      manager.updateGroup(group.id, { description: 'Updated' });

      // Cache should be invalidated
assert.strictEqual(manager.getCacheStats().size, 0);
    });

    it('should invalidate cache on delete', () => {
      const group = manager.createGroup({ name: 'gpt-4o' });
      manager.resolveGroup('gpt-4o'); // Populate cache

assert.strictEqual(manager.getCacheStats().size, 1);

      manager.deleteGroup(group.id);

      // Cache should be invalidated
assert.strictEqual(manager.getCacheStats().size, 0);
    });

    it('should manually refresh cache', () => {
      // Create groups
      manager.createGroup({ name: 'gpt-4o' });
      manager.createGroup({ name: 'claude-3' });

      // Clear cache
      manager.invalidateCache();
assert.strictEqual(manager.getCacheStats().size, 0);

      // Refresh
      manager.refreshCache();
assert.strictEqual(manager.getCacheStats().size, 2);
    });

    it('should manually invalidate specific group cache', () => {
      manager.createGroup({ name: 'gpt-4o' });
      manager.createGroup({ name: 'claude-3' });

      manager.refreshCache();
assert.strictEqual(manager.getCacheStats().size, 2);

      manager.invalidateCache('gpt-4o');
      const stats = manager.getCacheStats();
      assert.strictEqual(stats.size, 1);
assert.ok(!stats.keys.includes("gpt-4o"));
      assert.ok(stats.keys.includes('claude-3'));
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

      assert.strictEqual(stats.totalRequests, 0);
assert.ok("openai" in stats.channelDistribution);
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
      assert.strictEqual(stats.totalRequests, 3);
    });

    it('should reject stats for non-existent group', () => {
assert.throws(() => manager.getGroupStats(999), /not found/);
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
assert.strictEqual(manager.getGroupStats(group.id).totalRequests, 1);

      manager.resetStats(group.id);
assert.strictEqual(manager.getGroupStats(group.id).totalRequests, 0);
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

assert.strictEqual(manager.getGroupStats(group1.id).totalRequests, 0);
assert.strictEqual(manager.getGroupStats(group2.id).totalRequests, 0);
    });
  });

  describe('Type Guards', () => {
    it('should validate group mode', async () => {
      const { isGroupMode } = await import('../../src/groups/types.js');

assert.strictEqual(isGroupMode("round_robin"), true);
assert.strictEqual(isGroupMode("random"), true);
assert.strictEqual(isGroupMode("failover"), true);
assert.strictEqual(isGroupMode("weighted"), true);
assert.strictEqual(isGroupMode("invalid"), false);
assert.strictEqual(isGroupMode(null), false);
assert.strictEqual(isGroupMode(undefined), false);
    });

    it('should validate create group input', async () => {
      const { isCreateGroupInput } = await import('../../src/groups/types.js');

assert.strictEqual(isCreateGroupInput({ name: "gpt-4o" }), true);
assert.strictEqual(isCreateGroupInput({ name: "gpt-4o", mode: "round_robin" }), true);
assert.strictEqual(isCreateGroupInput({ name: "gpt-4o", description: "Test" }), true);
assert.strictEqual(isCreateGroupInput({}), false);
assert.strictEqual(isCreateGroupInput({ name: 123 }), false);
assert.strictEqual(isCreateGroupInput(null), false);
    });

    it('should validate add channel input', async () => {
      const { isAddChannelToGroupInput } = await import('../../src/groups/types.js');

      assert.strictEqual(isAddChannelToGroupInput({
        groupId: 1,
        channelId: 2,
        provider: 'openai',
      }), true);

      assert.strictEqual(isAddChannelToGroupInput({
        groupId: 1,
        channelId: 2,
        provider: 'openai',
        modelOverride: 'gpt-4',
        priority: 1,
        weight: 2,
      }), true);

assert.strictEqual(isAddChannelToGroupInput({}), false);
assert.strictEqual(isAddChannelToGroupInput({ groupId: "1", channelId: 2, provider: "openai" }), false);
    });
  });
});
