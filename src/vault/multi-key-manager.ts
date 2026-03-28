/**
 * Multi-Key Manager — handles multiple API keys per provider with
 * priority-based selection, cooldown management, and auto-rotation.
 *
 * Supports load balancing across multiple keys and automatic failover
 * when keys hit rate limits (429 errors).
 */

import type Database from 'better-sqlite3';

/** Status information for a single key */
export interface KeyStatus {
  id: number;
  key: string;
  keyName: string;
  provider: string;
  project: string;
  priority: number;
  cooldownUntil: number | null;
  lastUsedAt: number | null;
  requestCount: number;
  errorCount: number;
  consecutiveErrors: number;
  isAvailable: boolean;
}

/** Options for key selection */
export interface KeySelectionOptions {
  /** Provider identifier (e.g., 'openai') */
  provider: string;
  /** Project scope (defaults to '_global') */
  project?: string;
  /** Minimum priority level (inclusive) */
  minPriority?: number;
  /** Maximum priority level (inclusive) */
  maxPriority?: number;
}

/** Statistics for a key */
export interface KeyStatistics {
  id: number;
  requestCount: number;
  errorCount: number;
  consecutiveErrors: number;
  successRate: number;
  averageCooldownMs: number;
}

/** Row shape returned by SELECT queries with decrypted values */
interface CredentialRow {
  id: number;
  provider: string;
  key_name: string;
  project: string;
  encrypted_value: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  key_priority: number;
  cooldown_until: number | null;
  last_used_at: number | null;
  request_count: number;
  error_count: number;
  consecutive_errors: number;
}

/** MultiKeyManager configuration */
export interface MultiKeyManagerConfig {
  /** Default cooldown duration in milliseconds (default: 5 minutes) */
  defaultCooldownMs?: number;
  /** Maximum consecutive errors before extended cooldown (default: 3) */
  maxConsecutiveErrors?: number;
  /** Extended cooldown multiplier for repeated failures (default: 2x) */
  cooldownMultiplier?: number;
}

export class MultiKeyManager {
  private readonly db: Database.Database;
  private readonly defaultCooldownMs: number;
  private readonly maxConsecutiveErrors: number;
  private readonly cooldownMultiplier: number;

  constructor(db: Database.Database, config: MultiKeyManagerConfig = {}) {
    this.db = db;
    this.defaultCooldownMs = config.defaultCooldownMs ?? 5 * 60 * 1000; // 5 minutes
    this.maxConsecutiveErrors = config.maxConsecutiveErrors ?? 3;
    this.cooldownMultiplier = config.cooldownMultiplier ?? 2;
  }

  // ── Private Helpers ──────────────────────────────────────────────

  /**
   * Resolve project: if provided and not empty, return it; otherwise '_global'.
   */
  private resolveProject(project?: string): string {
    return project && project !== '' ? project : '_global';
  }

  /**
   * Decrypt an encrypted credential row.
   * Note: This requires the Vault's master key - we get decrypted values from Vault.
   */
  private mapRowToKeyStatus(row: CredentialRow, key: string): KeyStatus {
    const now = Date.now();
    const isAvailable = !row.cooldown_until || row.cooldown_until < now;

    return {
      id: row.id,
      key,
      keyName: row.key_name,
      provider: row.provider,
      project: row.project,
      priority: row.key_priority ?? 0,
      cooldownUntil: row.cooldown_until,
      lastUsedAt: row.last_used_at,
      requestCount: row.request_count ?? 0,
      errorCount: row.error_count ?? 0,
      consecutiveErrors: row.consecutive_errors ?? 0,
      isAvailable,
    };
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Add a new key for a provider.
   *
   * Note: The actual encrypted key storage is handled by Vault.store().
   * This method updates the key priority and metadata for an existing credential.
   *
   * @param keyId - The credential row id from Vault.store()
   * @param priority - Priority level (lower = higher priority, default: 0)
   * @returns true if the key was updated, false if not found
   */
  async addKey(keyId: number, priority = 0): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE credentials 
      SET key_priority = ?,
          request_count = 0,
          error_count = 0,
          consecutive_errors = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(priority, keyId);
    return result.changes > 0;
  }

  /**
   * Get the best available key for a provider.
   *
   * Selection order:
   * 1. Keys not in cooldown (cooldown_until < now)
   * 2. Ordered by priority (ascending - lower = higher priority)
   * 3. Then by last_used_at (ascending - LRU for load balancing)
   *
   * If all keys are in cooldown, returns the one with shortest remaining cooldown.
   *
   * @param options - Key selection options including provider and project
   * @returns KeyStatus with the decrypted key, or null if no keys available
   */
  async getKey(
    options: KeySelectionOptions,
    decryptFn: (encrypted: Buffer, iv: Buffer, authTag: Buffer) => string
  ): Promise<KeyStatus | null> {
    const project = this.resolveProject(options.project);
    const now = Date.now();

    // Query available keys not in cooldown, ordered by priority then LRU
    const availableStmt = this.db.prepare(`
      SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag,
             key_priority, cooldown_until, last_used_at, request_count, 
             error_count, consecutive_errors
      FROM credentials 
      WHERE provider = ? 
        AND (project = ? OR project = '_global')
        AND (cooldown_until IS NULL OR cooldown_until < ?)
        AND key_priority IS NOT NULL
      ORDER BY key_priority ASC, 
               COALESCE(last_used_at, 0) ASC
      LIMIT 1
    `);

    const row = availableStmt.get(
      options.provider,
      project,
      now
    ) as CredentialRow | undefined;

    if (row) {
      const key = decryptFn(row.encrypted_value, row.iv, row.auth_tag);
      return this.mapRowToKeyStatus(row, key);
    }

    // All keys in cooldown - find the one with shortest remaining
    return this.getSoonestAvailable(options, decryptFn);
  }

  /**
   * Get the key that will become available soonest (shortest remaining cooldown).
   */
  private async getSoonestAvailable(
    options: KeySelectionOptions,
    decryptFn: (encrypted: Buffer, iv: Buffer, authTag: Buffer) => string
  ): Promise<KeyStatus | null> {
    const project = this.resolveProject(options.project);
    const now = Date.now();

    const soonestStmt = this.db.prepare(`
      SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag,
             key_priority, cooldown_until, last_used_at, request_count, 
             error_count, consecutive_errors
      FROM credentials 
      WHERE provider = ? 
        AND (project = ? OR project = '_global')
        AND key_priority IS NOT NULL
      ORDER BY cooldown_until ASC
      LIMIT 1
    `);

    const row = soonestStmt.get(options.provider, project) as CredentialRow | undefined;

    if (row) {
      const key = decryptFn(row.encrypted_value, row.iv, row.auth_tag);
      return this.mapRowToKeyStatus(row, key);
    }

    return null;
  }

  /**
   * Mark a key as used (increments request_count and updates last_used_at).
   *
   * @param keyId - The credential row id
   */
  async markUsed(keyId: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE credentials 
      SET request_count = request_count + 1,
          last_used_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(Date.now(), keyId);
  }

  /**
   * Put a key on cooldown (e.g., after 429 error).
   *
   * The cooldown duration increases with consecutive errors to implement
   * exponential backoff for failing keys.
   *
   * @param keyId - The credential row id
   * @param durationMs - Optional custom cooldown duration (uses default if not specified)
   */
  async putOnCooldown(keyId: number, durationMs?: number): Promise<void> {
    // Get current consecutive errors to calculate backoff
    const infoStmt = this.db.prepare(
      'SELECT consecutive_errors FROM credentials WHERE id = ?'
    );
    const info = infoStmt.get(keyId) as { consecutive_errors: number } | undefined;
    const consecutiveErrors = info?.consecutive_errors ?? 0;

    // Calculate cooldown with exponential backoff for repeated failures
    let duration = durationMs ?? this.defaultCooldownMs;
    if (consecutiveErrors >= this.maxConsecutiveErrors) {
      duration *= this.cooldownMultiplier;
    }

    const cooldownUntil = Date.now() + duration;

    const stmt = this.db.prepare(`
      UPDATE credentials 
      SET cooldown_until = ?, 
          error_count = error_count + 1,
          consecutive_errors = consecutive_errors + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(cooldownUntil, keyId);
  }

  /**
   * Record a successful request (resets consecutive errors).
   *
   * @param keyId - The credential row id
   */
  async markSuccess(keyId: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE credentials 
      SET consecutive_errors = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(keyId);
  }

  /**
   * Record an error on a key (without putting on cooldown).
   * Use this for non-rate-limit errors.
   *
   * @param keyId - The credential row id
   */
  async recordError(keyId: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE credentials 
      SET error_count = error_count + 1,
          consecutive_errors = consecutive_errors + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(keyId);
  }

  /**
   * Get all keys for a provider with their status.
   *
   * @param provider - Provider identifier
   * @param project - Project scope (optional)
   * @param decryptFn - Function to decrypt the encrypted key
   * @returns Array of KeyStatus for all matching keys
   */
  async getAllKeys(
    provider: string,
    project: string | undefined,
    decryptFn: (encrypted: Buffer, iv: Buffer, authTag: Buffer) => string
  ): Promise<KeyStatus[]> {
    const resolvedProject = this.resolveProject(project);

    const stmt = this.db.prepare(`
      SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag,
             key_priority, cooldown_until, last_used_at, request_count, 
             error_count, consecutive_errors
      FROM credentials 
      WHERE provider = ? 
        AND (project = ? OR project = '_global')
        AND key_priority IS NOT NULL
      ORDER BY key_priority ASC
    `);

    const rows = stmt.all(provider, resolvedProject) as CredentialRow[];

    return rows.map((row) => {
      const key = decryptFn(row.encrypted_value, row.iv, row.auth_tag);
      return this.mapRowToKeyStatus(row, key);
    });
  }

  /**
   * Rotate to the next available key.
   *
   * This marks the current key as used (for LRU ordering) and returns
   * the next best available key. If no other keys are available,
   * returns the current key after its cooldown expires.
   *
   * @param currentKeyId - The currently used key id
   * @param options - Key selection options
   * @param decryptFn - Function to decrypt the encrypted key
   * @returns KeyStatus for the next key, or null if none available
   */
  async rotateKey(
    currentKeyId: number,
    options: KeySelectionOptions,
    decryptFn: (encrypted: Buffer, iv: Buffer, authTag: Buffer) => string
  ): Promise<KeyStatus | null> {
    // Mark current key as used to push it down in LRU order
    await this.markUsed(currentKeyId);

    // Get next available key (excluding the current one if still in cooldown)
    const project = this.resolveProject(options.project);
    const now = Date.now();

    const stmt = this.db.prepare(`
      SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag,
             key_priority, cooldown_until, last_used_at, request_count, 
             error_count, consecutive_errors
      FROM credentials 
      WHERE provider = ? 
        AND (project = ? OR project = '_global')
        AND id != ?
        AND (cooldown_until IS NULL OR cooldown_until < ?)
        AND key_priority IS NOT NULL
      ORDER BY key_priority ASC, 
               COALESCE(last_used_at, 0) ASC
      LIMIT 1
    `);

    const row = stmt.get(options.provider, project, currentKeyId, now) as
      | CredentialRow
      | undefined;

    if (row) {
      const key = decryptFn(row.encrypted_value, row.iv, row.auth_tag);
      return this.mapRowToKeyStatus(row, key);
    }

    // No other keys available - get the current key's status
    // (it will show cooldownUntil if on cooldown)
    return this.getKeyStatus(currentKeyId, decryptFn);
  }

  /**
   * Get key statistics.
   *
   * @param keyId - The credential row id
   * @param decryptFn - Function to decrypt the encrypted key (optional, for key field)
   * @returns KeyStatus with full statistics
   */
  async getKeyStatus(
    keyId: number,
    decryptFn?: (encrypted: Buffer, iv: Buffer, authTag: Buffer) => string
  ): Promise<KeyStatus | null> {
    const stmt = this.db.prepare(`
      SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag,
             key_priority, cooldown_until, last_used_at, request_count, 
             error_count, consecutive_errors
      FROM credentials 
      WHERE id = ?
    `);

    const row = stmt.get(keyId) as CredentialRow | undefined;

    if (!row) {
      return null;
    }

    let key = '[encrypted]';
    if (decryptFn) {
      key = decryptFn(row.encrypted_value, row.iv, row.auth_tag);
    }

    return this.mapRowToKeyStatus(row, key);
  }

  /**
   * Get detailed statistics for a key.
   *
   * @param keyId - The credential row id
   * @returns KeyStatistics with computed metrics
   */
  async getKeyStatistics(keyId: number): Promise<KeyStatistics | null> {
    const status = await this.getKeyStatus(keyId);

    if (!status) {
      return null;
    }

    const totalRequests = status.requestCount + status.errorCount;
    const successRate =
      totalRequests > 0 ? (status.requestCount / totalRequests) * 100 : 100;

    // Calculate average cooldown (simplified - in production, you'd track this)
    const averageCooldownMs =
      status.consecutiveErrors > 0
        ? this.defaultCooldownMs *
          Math.pow(this.cooldownMultiplier, status.consecutiveErrors - 1)
        : 0;

    return {
      id: keyId,
      requestCount: status.requestCount,
      errorCount: status.errorCount,
      consecutiveErrors: status.consecutiveErrors,
      successRate: Math.round(successRate * 100) / 100,
      averageCooldownMs,
    };
  }

  /**
   * Clear cooldown for a key (e.g., after manual recovery).
   *
   * @param keyId - The credential row id
   */
  async clearCooldown(keyId: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE credentials 
      SET cooldown_until = NULL,
          consecutive_errors = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(keyId);
  }

  /**
   * Reset all statistics for a key.
   *
   * @param keyId - The credential row id
   */
  async resetStats(keyId: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE credentials 
      SET request_count = 0,
          error_count = 0,
          consecutive_errors = 0,
          cooldown_until = NULL,
          last_used_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(keyId);
  }

  /**
   * Get summary of all keys for a provider.
   *
   * @param provider - Provider identifier
   * @param project - Project scope (optional)
   * @returns Summary statistics for the provider's keys
   */
  async getProviderSummary(
    provider: string,
    project?: string
  ): Promise<{
    totalKeys: number;
    availableKeys: number;
    keysInCooldown: number;
    totalRequests: number;
    totalErrors: number;
  }> {
    const resolvedProject = this.resolveProject(project);
    const now = Date.now();

    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total_keys,
        SUM(CASE WHEN cooldown_until IS NULL OR cooldown_until < ? THEN 1 ELSE 0 END) as available_keys,
        SUM(CASE WHEN cooldown_until IS NOT NULL AND cooldown_until >= ? THEN 1 ELSE 0 END) as keys_in_cooldown,
        COALESCE(SUM(request_count), 0) as total_requests,
        COALESCE(SUM(error_count), 0) as total_errors
      FROM credentials 
      WHERE provider = ? 
        AND (project = ? OR project = '_global')
        AND key_priority IS NOT NULL
    `);

    const result = stmt.get(now, now, provider, resolvedProject) as {
      total_keys: number;
      available_keys: number;
      keys_in_cooldown: number;
      total_requests: number;
      total_errors: number;
    };

    return {
      totalKeys: result.total_keys,
      availableKeys: result.available_keys,
      keysInCooldown: result.keys_in_cooldown,
      totalRequests: result.total_requests,
      totalErrors: result.total_errors,
    };
  }
}

export default MultiKeyManager;
