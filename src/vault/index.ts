export { Vault } from './vault.js';
export { MultiKeyManager } from './multi-key-manager.js';
export type { EncryptedData } from './crypto.js';
export type {
  KeyStatus,
  KeySelectionOptions,
  KeyStatistics,
  MultiKeyManagerConfig,
} from './multi-key-manager.js';
export {
  readClaudeOAuthToken,
  isTokenExpiringSoon,
  isTokenExpired,
  refreshTokenIfNeeded,
  syncToOpencodeAuth,
  readOpencodeAuth,
  type TokenInfo,
  type ClaudeOAuthCredentials,
  type OpencodeAuth,
} from './claude-oauth.js';
