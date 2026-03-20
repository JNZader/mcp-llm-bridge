import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { GatewayConfig } from './types.js';
import {
  DEFAULT_DB_FILENAME,
  DEFAULT_HTTP_PORT,
  DEFAULT_MASTER_KEY_FILENAME,
  MASTER_KEY_BYTES,
  MIN_AUTH_TOKEN_LENGTH,
} from './constants.js';
import { logger } from './logger.js';

const DEFAULT_DIR = join(homedir(), '.llm-gateway');
const DEFAULT_DB_PATH = join(DEFAULT_DIR, DEFAULT_DB_FILENAME);
const DEFAULT_MASTER_KEY_PATH = join(DEFAULT_DIR, DEFAULT_MASTER_KEY_FILENAME);

/**
 * Check if we're running in production mode.
 * Looks for common production indicators in environment.
 */
function isProduction(): boolean {
  const nodeEnv = process.env['NODE_ENV'];
  const gatewayEnv = process.env['LLM_GATEWAY_ENV'];
  const isProd = nodeEnv === 'production' || gatewayEnv === 'production';
  // Also consider it production if auth token is required via config
  return isProd;
}

/**
 * Ensure the gateway config directory exists with proper permissions.
 */
function ensureConfigDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load or auto-generate the master key.
 *
 * Priority:
 * 1. `LLM_GATEWAY_MASTER_KEY` env var (hex-encoded 32-byte key)
 * 2. Existing key file at `~/.llm-gateway/master.key`
 * 3. Auto-generate a new key and save to file with mode 0o600
 */
function loadMasterKey(): Buffer {
  const envKey = process.env['LLM_GATEWAY_MASTER_KEY'];

  if (envKey) {
    const buf = Buffer.from(envKey, 'hex');
    if (buf.length !== MASTER_KEY_BYTES) {
      throw new Error(
        `LLM_GATEWAY_MASTER_KEY must be a ${MASTER_KEY_BYTES * 2}-character hex string (${MASTER_KEY_BYTES} bytes). Got ${buf.length} bytes.`,
      );
    }
    return buf;
  }

  // Try reading from file
  if (existsSync(DEFAULT_MASTER_KEY_PATH)) {
    const hex = readFileSync(DEFAULT_MASTER_KEY_PATH, 'utf8').trim();
    const buf = Buffer.from(hex, 'hex');
    if (buf.length !== MASTER_KEY_BYTES) {
      throw new Error(
        `Master key file at ${DEFAULT_MASTER_KEY_PATH} is corrupted. Expected ${MASTER_KEY_BYTES} bytes, got ${buf.length}.`,
      );
    }
    return buf;
  }

  // Auto-generate
  ensureConfigDir(DEFAULT_DIR);
  const key = randomBytes(MASTER_KEY_BYTES);
  writeFileSync(DEFAULT_MASTER_KEY_PATH, key.toString('hex') + '\n', {
    mode: 0o600,
    encoding: 'utf8',
  });
  logger.info({ path: DEFAULT_MASTER_KEY_PATH }, 'Generated new master key');
  return key;
}



/**
 * Load gateway configuration from environment variables with sensible defaults.
 *
 * Environment variables:
 * - `LLM_GATEWAY_MASTER_KEY` — hex-encoded 32-byte encryption key
 * - `LLM_GATEWAY_DB_PATH` — path to SQLite vault database
 * - `LLM_GATEWAY_PORT` — HTTP server port
 * - `LLM_GATEWAY_AUTH_TOKEN` — bearer token for HTTP auth (optional, min 32 chars)
 */
export function loadConfig(): GatewayConfig {
  const masterKey = loadMasterKey();

  const dbPath = process.env['LLM_GATEWAY_DB_PATH'] ?? DEFAULT_DB_PATH;
  ensureConfigDir(join(dbPath, '..'));

  const portStr = process.env['LLM_GATEWAY_PORT'];
  const httpPort = portStr ? parseInt(portStr, 10) : DEFAULT_HTTP_PORT;

  if (isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new Error(`LLM_GATEWAY_PORT must be a valid port number (1-65535). Got: "${portStr}"`);
  }

  const rawAuthToken = process.env['LLM_GATEWAY_AUTH_TOKEN']?.trim();
  const authRequired = process.env['LLM_GATEWAY_AUTH_REQUIRED'];
  let authToken: string | undefined;

  // Explicit auth configuration: LLM_GATEWAY_AUTH_REQUIRED takes precedence
  const explicitAuthDisabled = authRequired === 'false';
  const explicitAuthRequired = authRequired === 'true';

  if (rawAuthToken) {
    if (rawAuthToken.length < MIN_AUTH_TOKEN_LENGTH) {
      throw new Error(
        `LLM_GATEWAY_AUTH_TOKEN must be at least ${MIN_AUTH_TOKEN_LENGTH} characters. Got ${rawAuthToken.length}.`,
      );
    }
    authToken = rawAuthToken;
  } else if (explicitAuthRequired) {
    throw new Error(
      'FATAL: LLM_GATEWAY_AUTH_TOKEN is required because LLM_GATEWAY_AUTH_REQUIRED=true. ' +
      'Set LLM_GATEWAY_AUTH_TOKEN environment variable.',
    );
  } else if (isProduction() && !explicitAuthDisabled) {
    throw new Error(
      'FATAL: LLM_GATEWAY_AUTH_TOKEN is required in production. ' +
      'Set LLM_GATEWAY_AUTH_TOKEN environment variable, set NODE_ENV=development, ' +
      'or set LLM_GATEWAY_AUTH_REQUIRED=false to explicitly disable auth.',
    );
  } else if (explicitAuthDisabled) {
    logger.info('Auth explicitly disabled via LLM_GATEWAY_AUTH_REQUIRED=false');
  } else {
    logger.warn('Auth disabled (not production, LLM_GATEWAY_AUTH_REQUIRED not set)');
  }

  return { masterKey, dbPath, httpPort, authToken };
}
