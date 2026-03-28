/**
 * TypeScript interfaces for Groups Feature
 *
 * Feature 11: Groups — Unified model names that aggregate multiple channels
 * with load balancing across providers.
 */

import { LoadBalanceMode } from '../balancer/types.js';

/**
 * Group load balancing modes
 * Uses const object + type pattern for single source of truth
 */
export const GROUP_MODE = {
  ROUND_ROBIN: 'round_robin',
  RANDOM: 'random',
  FAILOVER: 'failover',
  WEIGHTED: 'weighted',
} as const;

export type GroupMode = (typeof GROUP_MODE)[keyof typeof GROUP_MODE];

/**
 * Default group mode
 */
export const DEFAULT_GROUP_MODE: GroupMode = GROUP_MODE.ROUND_ROBIN;

/**
 * Group entity representing a unified model name
 */
export interface Group {
  /** Unique identifier */
  id: number;
  /** Exposed model name (e.g., "gpt-4o") */
  name: string;
  /** Optional description */
  description?: string;
  /** Load balancing mode for this group */
  mode: GroupMode;
  /** Associated channels in this group */
  channels: GroupChannel[];
  /** Unix timestamp when created */
  createdAt: number;
  /** Unix timestamp when last updated */
  updatedAt: number;
}

/**
 * Channel assignment within a group
 */
export interface GroupChannel {
  /** Unique identifier */
  id: number;
  /** Reference to parent group */
  groupId: number;
  /** Reference to credentials.id */
  channelId: number;
  /** Resolved provider name from credentials */
  provider: string;
  /** Use different model name at this channel (null = use group's name) */
  modelOverride?: string;
  /** Priority for failover mode (lower = higher priority) */
  priority: number;
  /** Weight for weighted mode (default: 1) */
  weight: number;
  /** Whether this channel is active */
  isActive: boolean;
}

/**
 * Input for creating a new group
 */
export interface CreateGroupInput {
  /** Exposed model name (e.g., "gpt-4o") - must be unique */
  name: string;
  /** Optional description */
  description?: string;
  /** Load balancing mode (default: round_robin) */
  mode?: GroupMode;
}

/**
 * Input for adding a channel to a group
 */
export interface AddChannelToGroupInput {
  /** Group ID to add channel to */
  groupId: number;
  /** Channel ID (credentials.id) to add */
  channelId: number;
  /** Provider name (e.g., "openai", "groq") */
  provider: string;
  /** Override model name for this channel */
  modelOverride?: string;
  /** Priority for failover mode (lower = higher priority, default: 0) */
  priority?: number;
  /** Weight for weighted mode (default: 1) */
  weight?: number;
  /** Whether this channel is active (default: true) */
  isActive?: boolean;
}

/**
 * Result of a group routing decision
 */
export interface RoutingDecision {
  /** The group name that was requested */
  groupName: string;
  /** Selected provider name */
  selectedProvider: string;
  /** Selected channel ID (credentials.id) */
  selectedChannelId: number;
  /** Actual model name to use (may be overridden) */
  actualModel: string;
  /** Routing mode used */
  routingMode: string;
  /** Attempt number (for retry logic) */
  attempt: number;
}

/**
 * Group statistics for monitoring
 */
export interface GroupStats {
  /** Total number of requests routed through this group */
  totalRequests: number;
  /** Distribution of requests across channels */
  channelDistribution: Record<string, number>;
}

/**
 * Group filter options for listing
 */
export interface GroupFilter {
  /** Filter by name (partial match) */
  name?: string;
  /** Filter by mode */
  mode?: GroupMode;
}

// Type guards for runtime type checking

/**
 * Check if a value is a valid GroupMode
 */
export function isGroupMode(value: unknown): value is GroupMode {
  if (typeof value !== 'string') return false;
  return Object.values(GROUP_MODE).includes(value as GroupMode);
}

/**
 * Check if a value is a valid CreateGroupInput
 */
export function isCreateGroupInput(value: unknown): value is CreateGroupInput {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as Partial<CreateGroupInput>;

  if (typeof input.name !== 'string') return false;
  if (input.description !== undefined && typeof input.description !== 'string') return false;
  if (input.mode !== undefined && !isGroupMode(input.mode)) return false;

  return true;
}

/**
 * Check if a value is a valid AddChannelToGroupInput
 */
export function isAddChannelToGroupInput(value: unknown): value is AddChannelToGroupInput {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as Partial<AddChannelToGroupInput>;

  if (typeof input.groupId !== 'number') return false;
  if (typeof input.channelId !== 'number') return false;
  if (typeof input.provider !== 'string') return false;
  if (input.modelOverride !== undefined && typeof input.modelOverride !== 'string') return false;
  if (input.priority !== undefined && typeof input.priority !== 'number') return false;
  if (input.weight !== undefined && typeof input.weight !== 'number') return false;
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') return false;

  return true;
}

/**
 * Check if a value is a valid Group
 */
export function isGroup(value: unknown): value is Group {
  if (typeof value !== 'object' || value === null) return false;
  const group = value as Partial<Group>;

  return (
    typeof group.id === 'number' &&
    typeof group.name === 'string' &&
    (group.description === undefined || typeof group.description === 'string') &&
    isGroupMode(group.mode) &&
    Array.isArray(group.channels) &&
    typeof group.createdAt === 'number' &&
    typeof group.updatedAt === 'number'
  );
}

/**
 * Check if a value is a valid GroupChannel
 */
export function isGroupChannel(value: unknown): value is GroupChannel {
  if (typeof value !== 'object' || value === null) return false;
  const channel = value as Partial<GroupChannel>;

  return (
    typeof channel.id === 'number' &&
    typeof channel.groupId === 'number' &&
    typeof channel.channelId === 'number' &&
    typeof channel.provider === 'string' &&
    (channel.modelOverride === undefined || typeof channel.modelOverride === 'string') &&
    typeof channel.priority === 'number' &&
    typeof channel.weight === 'number' &&
    typeof channel.isActive === 'boolean'
  );
}
