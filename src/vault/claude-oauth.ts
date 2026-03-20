/**
 * Claude CLI OAuth token integration.
 *
 * Reads OAuth tokens from the Claude CLI's credentials file,
 * handles token expiry checking, and syncs credentials to opencode auth.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** Claude CLI OAuth credentials file format. */
export interface ClaudeOAuthCredentials {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // Unix timestamp in milliseconds
  token_type?: string;
}

/** Token with expiry information. */
export interface TokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  expiresIn?: number;
}

/** Opencode auth.json format. */
export interface OpencodeAuth {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  provider?: string;
  updated_at?: string;
}

/** Path to Claude CLI credentials on Linux. */
const CLAUDE_CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

/** Path to opencode auth.json. */
const OPENCODE_AUTH_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json');

/** Token refresh threshold: refresh if expiring within 5 minutes. */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Read and parse Claude CLI OAuth token from ~/.claude/.credentials.json.
 *
 * @returns Token info with expiry data, or null if file doesn't exist or parse fails
 */
export function readClaudeOAuthToken(): TokenInfo | null {
  try {
    if (!existsSync(CLAUDE_CREDENTIALS_PATH)) {
      return null;
    }

    const content = readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8');
    const creds: ClaudeOAuthCredentials = JSON.parse(content);

    // Validate required fields
    if (!creds.access_token || typeof creds.access_token !== 'string') {
      return null;
    }

    return {
      accessToken: creds.access_token,
      refreshToken: creds.refresh_token,
      expiresAt: creds.expires_at,
    };
  } catch (error) {
    // File doesn't exist, JSON parse error, or other read failure
    return null;
  }
}

/**
 * Check if a token is expiring soon (within 5 minutes).
 *
 * @param token - Token info with optional expiry timestamp
 * @returns true if token is missing expiry or expires within 5 minutes
 */
export function isTokenExpiringSoon(token: TokenInfo): boolean {
  // If no expiry information, assume it's still valid (might be a long-lived token)
  if (!token.expiresAt) {
    return false;
  }

  const now = Date.now();
  const timeUntilExpiry = token.expiresAt - now;

  return timeUntilExpiry <= TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Check if a token has already expired.
 *
 * @param token - Token info with optional expiry timestamp
 * @returns true if token has expired
 */
export function isTokenExpired(token: TokenInfo): boolean {
  if (!token.expiresAt) {
    return false;
  }
  return Date.now() >= token.expiresAt;
}

/**
 * Refresh the OAuth token if needed.
 *
 * NOTE: The actual Claude CLI refresh API may not be publicly documented.
 * This function provides the structure for token refresh logic.
 * The refresh_token from .credentials.json would be used if the API exists.
 *
 * @param token - Current token info with refresh_token
 * @returns Refreshed token info, or original token if refresh fails/unavailable
 */
export async function refreshTokenIfNeeded(token: TokenInfo): Promise<TokenInfo> {
  // If token is not expiring soon, return as-is
  if (!isTokenExpiringSoon(token)) {
    return token;
  }

  // If no refresh token, cannot refresh
  if (!token.refreshToken) {
    return token;
  }

  // TODO: Implement actual token refresh when Claude CLI API is documented
  // The refresh would typically call an endpoint like:
  // POST /oauth/refresh with { refresh_token: token.refreshToken }
  //
  // For now, we log a warning and return the existing token.
  // In production, this could be extended once the refresh endpoint is known.

  console.warn('[claude-oauth] Token refresh not yet implemented. Consider re-authenticating with Claude CLI.');

  return token;
}

/**
 * Sync Claude OAuth credentials to opencode's auth.json format.
 *
 * @param token - Token info to sync
 * @param _project - Optional project identifier for multi-tenant support (reserved for future use)
 * @returns true if sync succeeded
 */
export function syncToOpencodeAuth(token: TokenInfo, _project?: string): boolean {
  try {
    const dir = dirname(OPENCODE_AUTH_PATH);

    // Ensure directory exists with proper permissions
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const authData: OpencodeAuth = {
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expires_at: token.expiresAt,
      provider: 'claude-cli',
      updated_at: new Date().toISOString(),
    };

    writeFileSync(OPENCODE_AUTH_PATH, JSON.stringify(authData, null, 2), 'utf-8');

    return true;
  } catch (error) {
    console.error('[claude-oauth] Failed to sync to opencode auth:', error);
    return false;
  }
}

/**
 * Read existing opencode auth.json if it exists.
 *
 * @returns Parsed auth data or null
 */
export function readOpencodeAuth(): OpencodeAuth | null {
  try {
    if (!existsSync(OPENCODE_AUTH_PATH)) {
      return null;
    }

    const content = readFileSync(OPENCODE_AUTH_PATH, 'utf-8');
    return JSON.parse(content) as OpencodeAuth;
  } catch {
    return null;
  }
}
