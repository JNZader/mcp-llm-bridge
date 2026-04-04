/**
 * Security module — trust-level-based tool filtering and rate limiting.
 */

export {
  TOOL_CATEGORIES,
  PROFILES,
  ToolCategorySchema,
  TrustLevelSchema,
  SecurityProfileSchema,
  RateLimitConfigSchema,
  createDbProfileResolver,
  type ToolCategory,
  type SecurityProfile,
  type RateLimitConfig,
  type ProfileResolver,
} from './profiles.js';

export { ProfileEnforcer } from './enforcer.js';

export { sanitizeErrorMessage } from './sanitize.js';
