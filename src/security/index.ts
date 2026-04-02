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
  type ToolCategory,
  type SecurityProfile,
  type RateLimitConfig,
} from './profiles.js';

export { ProfileEnforcer } from './enforcer.js';
