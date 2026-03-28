/**
 * Group Manager
 *
 * Feature 11: Groups — Unified model names that aggregate multiple channels
 * with load balancing across providers.
 *
 * Manages group CRUD operations, channel assignments, and routing decisions
 * with in-memory caching for fast lookups.
 */

import { Database } from 'better-sqlite3';
import {
  Group,
  GroupChannel,
  CreateGroupInput,
  AddChannelToGroupInput,
  RoutingDecision,
  GroupStats,
  GroupFilter,
  GroupMode,
  DEFAULT_GROUP_MODE,
  isGroupMode,
} from './types.js';
import {
  LoadBalancer,
  ProviderCandidate,
  LOAD_BALANCE_MODE,
  LoadBalanceMode,
} from '../balancer/index.js';
import { SessionManager } from '../session/index.js';

/**
 * Database row for groups table
 */
interface GroupRow {
  id: number;
  name: string;
  description: string | null;
  mode: string;
  created_at: number;
  updated_at: number;
}

/**
 * Database row for group_channels table
 */
interface GroupChannelRow {
  id: number;
  group_id: number;
  channel_id: number;
  model_override: string | null;
  priority: number;
  weight: number;
  is_active: number;
  provider: string;
}

/**
 * Manages groups for unified model name routing
 */
export class GroupManager {
  private db: Database;
  private cache: Map<string, Group>; // name -> group
  private balancer: LoadBalancer;
  private sessionManager: SessionManager;
  private requestStats: Map<number, number>; // groupId -> count

  /**
   * Create a new GroupManager
   * @param db - SQLite database instance
   * @param sessionManager - SessionManager for sticky session support
   */
  constructor(db: Database, sessionManager: SessionManager) {
    this.db = db;
    this.cache = new Map();
    this.balancer = new LoadBalancer(LOAD_BALANCE_MODE.ROUND_ROBIN);
    this.sessionManager = sessionManager;
    this.requestStats = new Map();
  }

  /**
   * Initialize the manager by loading all groups into cache
   */
  initialize(): void {
    this.refreshCache();
  }

  // ==================== CRUD Operations ====================

  /**
   * Create a new group
   * @param input - Group creation input
   * @returns Created group
   * @throws Error if group name already exists
   */
  createGroup(input: CreateGroupInput): Group {
    if (!input.name || input.name.trim() === '') {
      throw new Error('Group name is required');
    }

    const normalizedName = input.name.trim();
    const mode = input.mode ?? DEFAULT_GROUP_MODE;

    // Validate mode
    if (!isGroupMode(mode)) {
      throw new Error(`Invalid group mode: ${mode}`);
    }

    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      INSERT INTO groups (name, description, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    try {
      const result = stmt.run(
        normalizedName,
        input.description ?? null,
        mode,
        now,
        now
      );

      const group: Group = {
        id: Number(result.lastInsertRowid),
        name: normalizedName,
        description: input.description,
        mode,
        channels: [],
        createdAt: now,
        updatedAt: now,
      };

      // Update cache
      this.cache.set(normalizedName, group);

      return group;
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Group with name "${normalizedName}" already exists`);
      }
      throw error;
    }
  }

  /**
   * Get a group by ID
   * @param id - Group ID
   * @returns Group or null if not found
   */
  getGroup(id: number): Group | null {
    const row = this.db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined;
    if (!row) return null;

    const channels = this.loadGroupChannels(id);
    return this.rowToGroup(row, channels);
  }

  /**
   * Get a group by name (uses cache)
   * @param name - Group name
   * @returns Group or null if not found
   */
  getGroupByName(name: string): Group | null {
    // Check cache first
    const cached = this.cache.get(name);
    if (cached) return cached;

    // Load from database
    const row = this.db.prepare('SELECT * FROM groups WHERE name = ?').get(name) as GroupRow | undefined;
    if (!row) return null;

    const channels = this.loadGroupChannels(row.id);
    const group = this.rowToGroup(row, channels);

    // Update cache
    this.cache.set(name, group);

    return group;
  }

  /**
   * Update a group
   * @param id - Group ID
   * @param updates - Partial group updates
   * @returns Updated group
   * @throws Error if group not found or name conflict
   */
  updateGroup(id: number, updates: Partial<Pick<Group, 'name' | 'description' | 'mode'>>): Group {
    const existing = this.getGroup(id);
    if (!existing) {
      throw new Error(`Group with id ${id} not found`);
    }

    // Validate mode if provided
    if (updates.mode && !isGroupMode(updates.mode)) {
      throw new Error(`Invalid group mode: ${updates.mode}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name.trim());
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description ?? null);
    }
    if (updates.mode !== undefined) {
      fields.push('mode = ?');
      values.push(updates.mode);
    }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE groups SET ${fields.join(', ')} WHERE id = ?
    `);

    try {
      stmt.run(...values);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Group with name "${updates.name}" already exists`);
      }
      throw error;
    }

    // Invalidate cache
    this.invalidateCache(existing.name);
    if (updates.name && updates.name !== existing.name) {
      this.invalidateCache(updates.name);
    }

    // Return updated group
    return this.getGroup(id)!;
  }

  /**
   * Delete a group and all its channel assignments
   * @param id - Group ID
   * @throws Error if group not found
   */
  deleteGroup(id: number): void {
    const existing = this.getGroup(id);
    if (!existing) {
      throw new Error(`Group with id ${id} not found`);
    }

    // Delete from database (cascade will handle group_channels)
    this.db.prepare('DELETE FROM groups WHERE id = ?').run(id);

    // Invalidate cache
    this.invalidateCache(existing.name);
  }

  /**
   * List all groups with optional filtering
   * @param filter - Optional filter criteria
   * @returns Array of groups
   */
  listGroups(filter?: GroupFilter): Group[] {
    let query = 'SELECT * FROM groups';
    const params: (string | number)[] = [];

    const conditions: string[] = [];

    if (filter?.name) {
      conditions.push('name LIKE ?');
      params.push(`%${filter.name}%`);
    }

    if (filter?.mode) {
      conditions.push('mode = ?');
      params.push(filter.mode);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY name';

    const rows = this.db.prepare(query).all(...params) as GroupRow[];

    return rows.map(row => {
      const channels = this.loadGroupChannels(row.id);
      return this.rowToGroup(row, channels);
    });
  }

  // ==================== Channel Management ====================

  /**
   * Add a channel to a group
   * @param input - Channel assignment input
   * @returns Created group channel
   * @throws Error if group not found
   */
  addChannel(input: AddChannelToGroupInput): GroupChannel {
    const group = this.getGroup(input.groupId);
    if (!group) {
      throw new Error(`Group with id ${input.groupId} not found`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO group_channels (group_id, channel_id, model_override, priority, weight, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
      const result = stmt.run(
        input.groupId,
        input.channelId,
        input.modelOverride ?? null,
        input.priority ?? 0,
        input.weight ?? 1,
        input.isActive !== false ? 1 : 0 // is_active: default to true unless explicitly false
      );

      const channel: GroupChannel = {
        id: Number(result.lastInsertRowid),
        groupId: input.groupId,
        channelId: input.channelId,
        provider: input.provider,
        modelOverride: input.modelOverride,
        priority: input.priority ?? 0,
        weight: input.weight ?? 1,
        isActive: input.isActive !== false, // default to true unless explicitly false
      };

      // Invalidate cache
      this.invalidateCache(group.name);

      return channel;
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`Channel ${input.channelId} is already in group ${input.groupId}`);
      }
      throw error;
    }
  }

  /**
   * Remove a channel from a group
   * @param groupId - Group ID
   * @param channelId - Channel ID to remove
   * @throws Error if group not found
   */
  removeChannel(groupId: number, channelId: number): void {
    const group = this.getGroup(groupId);
    if (!group) {
      throw new Error(`Group with id ${groupId} not found`);
    }

    this.db.prepare(
      'DELETE FROM group_channels WHERE group_id = ? AND channel_id = ?'
    ).run(groupId, channelId);

    // Invalidate cache
    this.invalidateCache(group.name);
  }

  /**
   * Update a channel's configuration within a group
   * @param groupId - Group ID
   * @param channelId - Channel ID
   * @param updates - Partial channel updates
   * @returns Updated group channel
   */
  updateChannel(
    groupId: number,
    channelId: number,
    updates: Partial<Pick<GroupChannel, 'modelOverride' | 'priority' | 'weight' | 'isActive'>>
  ): GroupChannel {
    const group = this.getGroup(groupId);
    if (!group) {
      throw new Error(`Group with id ${groupId} not found`);
    }

    const existingChannel = group.channels.find(c => c.channelId === channelId);
    if (!existingChannel) {
      throw new Error(`Channel ${channelId} not found in group ${groupId}`);
    }

    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.modelOverride !== undefined) {
      fields.push('model_override = ?');
      values.push(updates.modelOverride ?? null);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }
    if (updates.weight !== undefined) {
      fields.push('weight = ?');
      values.push(updates.weight);
    }
    if (updates.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.isActive ? 1 : 0);
    }

    if (fields.length === 0) {
      return existingChannel;
    }

    values.push(groupId);
    values.push(channelId);

    this.db.prepare(`
      UPDATE group_channels SET ${fields.join(', ')} WHERE group_id = ? AND channel_id = ?
    `).run(...values);

    // Invalidate cache
    this.invalidateCache(group.name);

    // Return updated channel
    const updatedGroup = this.getGroup(groupId)!;
    return updatedGroup.channels.find(c => c.channelId === channelId)!;
  }

  /**
   * Get all channels for a group
   * @param groupId - Group ID
   * @returns Array of group channels
   */
  getGroupChannels(groupId: number): GroupChannel[] {
    return this.loadGroupChannels(groupId);
  }

  // ==================== Routing Logic ====================

  /**
   * Resolve a group by model name
   * @param modelName - Model name to resolve
   * @returns Group or null if not found
   */
  resolveGroup(modelName: string): Group | null {
    return this.getGroupByName(modelName);
  }

  /**
   * Select a channel from a group using the configured load balancing mode
   * @param group - Group to select from
   * @param context - Optional routing context for sticky sessions
   * @returns Routing decision or null if no active channels
   */
  selectChannel(
    group: Group,
    context?: { apiKeyId?: number; sessionId?: string }
  ): RoutingDecision | null {
    // Filter active channels
    const activeChannels = group.channels.filter(c => c.isActive);
    if (activeChannels.length === 0) return null;

    // Check for sticky session first
    if (context?.sessionId) {
      const session = this.sessionManager.getSession(context.sessionId);
      if (session) {
        const stickyChannel = activeChannels.find(c => c.channelId.toString() === session.keyId);
        if (stickyChannel) {
          return {
            groupName: group.name,
            selectedProvider: stickyChannel.provider,
            selectedChannelId: stickyChannel.channelId,
            actualModel: stickyChannel.modelOverride || group.name,
            routingMode: 'sticky',
            attempt: 1,
          };
        }
      }
    }

    // Convert to balancer candidates
    const candidates: ProviderCandidate[] = activeChannels.map(channel => ({
      id: `${channel.channelId}`,
      provider: channel.provider,
      keyId: `${channel.channelId}`,
      model: channel.modelOverride || group.name,
      priority: channel.priority,
      weight: channel.weight,
      healthy: true, // TODO: Integrate with circuit breaker
    }));

    // Map group mode to balancer mode and set only if changed
    const balancerMode = this.mapGroupModeToBalancerMode(group.mode);
    if (this.balancer.getMode() !== balancerMode) {
      this.balancer.setMode(balancerMode);
    }

    // Use balancer to select
    const selected = this.balancer.select(candidates);

    if (!selected) return null;

    // Find the full channel details
    const selectedChannel = activeChannels.find(
      c => c.channelId === parseInt(selected.keyId)
    )!;

    // Update stats
    const currentCount = this.requestStats.get(group.id) ?? 0;
    this.requestStats.set(group.id, currentCount + 1);

    return {
      groupName: group.name,
      selectedProvider: selected.provider,
      selectedChannelId: selectedChannel.channelId,
      actualModel: selectedChannel.modelOverride || group.name,
      routingMode: group.mode,
      attempt: 1,
    };
  }

  /**
   * Map group mode to balancer mode
   */
  private mapGroupModeToBalancerMode(groupMode: GroupMode): LoadBalanceMode {
    const mapping: Record<GroupMode, LoadBalanceMode> = {
      round_robin: LOAD_BALANCE_MODE.ROUND_ROBIN,
      random: LOAD_BALANCE_MODE.RANDOM,
      failover: LOAD_BALANCE_MODE.FAILOVER,
      weighted: LOAD_BALANCE_MODE.WEIGHTED,
    };
    return mapping[groupMode];
  }

  // ==================== Cache Management ====================

  /**
   * Refresh the entire cache by reloading all groups from database
   */
  refreshCache(): void {
    this.cache.clear();

    const groups = this.listGroups();
    for (const group of groups) {
      this.cache.set(group.name, group);
    }
  }

  /**
   * Invalidate cache for a specific group or all groups
   * @param groupName - Optional group name to invalidate (if omitted, clears all)
   */
  invalidateCache(groupName?: string): void {
    if (groupName) {
      this.cache.delete(groupName);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  // ==================== Statistics ====================

  /**
   * Get statistics for a group
   * @param groupId - Group ID
   * @returns Group statistics
   */
  getGroupStats(groupId: number): GroupStats {
    const group = this.getGroup(groupId);
    if (!group) {
      throw new Error(`Group with id ${groupId} not found`);
    }

    // Calculate channel distribution
    const distribution: Record<string, number> = {};
    // In a real implementation, this would query actual request logs
    // For now, return uniform distribution
    for (const channel of group.channels) {
      distribution[channel.provider] = 0;
    }

    return {
      totalRequests: this.requestStats.get(groupId) ?? 0,
      channelDistribution: distribution,
    };
  }

  /**
   * Reset statistics for a group or all groups
   * @param groupId - Optional group ID to reset (if omitted, resets all)
   */
  resetStats(groupId?: number): void {
    if (groupId !== undefined) {
      this.requestStats.delete(groupId);
    } else {
      this.requestStats.clear();
    }
  }

  // ==================== Private Helpers ====================

  /**
   * Load channels for a group from database
   */
  private loadGroupChannels(groupId: number): GroupChannel[] {
    const rows = this.db.prepare(`
      SELECT gc.*, c.provider
      FROM group_channels gc
      JOIN credentials c ON gc.channel_id = c.id
      WHERE gc.group_id = ?
      ORDER BY gc.priority, gc.id
    `).all(groupId) as GroupChannelRow[];

    return rows.map(row => ({
      id: row.id,
      groupId: row.group_id,
      channelId: row.channel_id,
      provider: row.provider,
      modelOverride: row.model_override ?? undefined,
      priority: row.priority,
      weight: row.weight,
      isActive: row.is_active === 1,
    }));
  }

  /**
   * Convert database row to Group object
   */
  private rowToGroup(row: GroupRow, channels: GroupChannel[]): Group {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      mode: row.mode as GroupMode,
      channels,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Create a GroupManager instance with initialized cache
 * @param db - SQLite database instance
 * @param sessionManager - SessionManager for sticky session support
 * @returns Initialized GroupManager
 */
export function createGroupManager(
  db: Database,
  sessionManager: SessionManager
): GroupManager {
  const manager = new GroupManager(db, sessionManager);
  manager.initialize();
  return manager;
}
