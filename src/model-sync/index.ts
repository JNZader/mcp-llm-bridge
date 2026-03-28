/**
 * Model Sync Module
 *
 * Auto Model Sync feature - exports all types and classes.
 */

// Types
export {
  PROVIDER_TYPE,
  isProviderType,
  isModelInfo,
  isModelSyncConfig,
} from './types.js';

export type {
  ProviderType,
  ModelInfo,
  ModelPricing,
  ModelSyncConfig,
  ModelSyncResult,
  ProviderModelRecord,
  ModelSyncLogRecord,
} from './types.js';

// Fetchers
export {
  OpenAIModelFetcher,
  AnthropicModelFetcher,
  GeminiModelFetcher,
  modelFetchers,
  getFetcherForProvider,
  isSupportedProvider,
} from './fetcher.js';

export type { ModelFetcher, FetcherClass } from './fetcher.js';

// Sync Manager
export {
  ModelSyncManager,
  createModelSyncManager,
} from './sync-manager.js';

export type { Database, Statement } from './sync-manager.js';
