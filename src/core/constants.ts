/**
 * Gateway constants.
 */

export const VERSION = '0.3.1';

/** Project scope for global (non-scoped) credentials. */
export const GLOBAL_PROJECT = '_global';

/** Minimum length for the auth token to prevent weak secrets. */
export const MIN_AUTH_TOKEN_LENGTH = 32;

/** Default HTTP port. */
export const DEFAULT_HTTP_PORT = 3456;

/** Default database path relative to home directory. */
export const DEFAULT_DB_FILENAME = 'vault.db';

/** Default master key filename. */
export const DEFAULT_MASTER_KEY_FILENAME = 'master.key';

/** Master key size in bytes (256 bits). */
export const MASTER_KEY_BYTES = 32;

/** Masked value configuration. */
export const MASK_VISIBLE_CHARS = 7;
export const MASK_SUFFIX = '...***';

/** Maximum request body size (1MB). */
export const MAX_BODY_SIZE = 1_000_000;

/** Maximum prompt length (100KB) to prevent resource exhaustion. */
export const MAX_PROMPT_LENGTH = 102_400;

/** Valid provider IDs for credential validation. */
export const VALID_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'google',
  'groq',
  'openrouter',
  'opencode-cli',
  'claude-cli',
  'gemini-cli',
  'codex-cli',
  'qwen-cli',
  'copilot-cli',
]);

/** Default log level. */
export const DEFAULT_LOG_LEVEL = 'info' as const;
