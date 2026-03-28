/**
 * Groups Module
 *
 * Feature 11: Groups — Unified model names that aggregate multiple channels
 * with load balancing across providers.
 *
 * @example
 * ```typescript
 * import { GroupManager, createGroupManager } from './groups/index.js';
 *
 * // Create with database and session manager
 * const groupManager = createGroupManager(db, sessionManager);
 *
 * // Create a group for unified GPT-4o access
 * const group = groupManager.createGroup({
 *   name: 'gpt-4o',
 *   description: 'Unified GPT-4o access across providers',
 *   mode: 'round_robin',
 * });
 *
 * // Add channels from different providers
 * groupManager.addChannel({
 *   groupId: group.id,
 *   channelId: 1, // OpenAI credentials.id
 *   provider: 'openai',
 *   priority: 1,
 *   weight: 3,
 * });
 *
 * groupManager.addChannel({
 *   groupId: group.id,
 *   channelId: 2, // Groq credentials.id
 *   provider: 'groq',
 *   modelOverride: 'llama-3.1-70b-versatile',
 *   priority: 2,
 *   weight: 1,
 * });
 *
 * // Route a request through the group
 * const decision = groupManager.selectChannel(group, {
 *   apiKeyId: 123,
 *   sessionId: 'sess_...',
 * });
 *
 * if (decision) {
 *   console.log(`Route to ${decision.selectedProvider} using ${decision.actualModel}`);
 * }
 * ```
 */

// Core class
export { GroupManager, createGroupManager } from './group-manager.js';

// Types
export type {
  Group,
  GroupChannel,
  CreateGroupInput,
  AddChannelToGroupInput,
  RoutingDecision,
  GroupStats,
  GroupFilter,
  GroupMode,
} from './types.js';

// Constants and type guards
export {
  GROUP_MODE,
  DEFAULT_GROUP_MODE,
  isGroupMode,
  isCreateGroupInput,
  isAddChannelToGroupInput,
  isGroup,
  isGroupChannel,
} from './types.js';
