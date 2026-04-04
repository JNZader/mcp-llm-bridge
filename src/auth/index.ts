/**
 * Auth module — API key management, middleware, and quota enforcement.
 *
 * Barrel export for the entire auth subsystem.
 */

// Types
export type {
  ApiKey,
  UserContext,
  CreateKeyOpts,
  RateLimitConfig,
} from './types.js';

export { API_KEY_PREFIX, API_KEY_HEX_LENGTH } from './types.js';

// Key management
export {
  generateApiKey,
  hashApiKey,
  createApiKey,
  revokeApiKey,
  lookupByHash,
  listApiKeys,
} from './keys.js';

// Quota enforcement
export type { RateLimitResult, BudgetResult } from './quotas.js';
export { checkRateLimit, checkBudget } from './quotas.js';

// Middleware
export { apiKeyAuth } from './middleware.js';
