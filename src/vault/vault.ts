/**
 * Credential Vault — encrypted storage for API keys.
 *
 * Uses SQLite (better-sqlite3) for persistence and AES-256-GCM
 * for encryption. The master key is held in memory for the lifetime
 * of the Vault instance.
 *
 * Supports per-project credential scoping: credentials can be global
 * (shared by all projects) or scoped to a specific project.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { GatewayConfig, MaskedCredential, StoredFile } from '../core/types.js';
import { encrypt, decrypt } from './crypto.js';
import { initializeDb } from './schema.js';
import {
  readClaudeOAuthToken,
  refreshTokenIfNeeded,
  syncToOpencodeAuth,
  type TokenInfo,
} from './claude-oauth.js';
import {
  GLOBAL_PROJECT,
  MASK_VISIBLE_CHARS,
  MASK_SUFFIX,
} from '../core/constants.js';
import { childLogger } from '../core/logger.js';

// ── Vault Audit Logging ─────────────────────────────────────

/** Structured audit event for vault operations. */
export interface VaultAuditEvent {
  action: 'store' | 'delete' | 'access' | 'list' | 'store_file' | 'delete_file' | 'access_file';
  provider: string;
  keyName?: string;
  fileName?: string;
  project: string;
  success: boolean;
  error?: string;
}

/**
 * Pino child logger scoped to vault audit events.
 *
 * Retention policy: In production, configure Pino transport-level log rotation
 * (e.g. pino-roll with `frequency: 'daily'` and `limit: { count: 30 }`) to
 * enforce 30-day retention. In development, logs are ephemeral (pino-pretty).
 */
export const vaultAuditLogger = childLogger({ component: 'vault-audit' });

/** Row shape returned by SELECT queries on the credentials table. */
interface CredentialRow {
  id: number;
  provider: string;
  key_name: string;
  project: string;
  encrypted_value: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  length_hint: number | null;
  created_at: string;
  updated_at: string;
}

/** Row shape returned by SELECT queries on the files table. */
interface FileRow {
  id: number;
  provider: string;
  file_name: string;
  project: string;
  encrypted_value: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  created_at: string;
  updated_at: string;
}

export class Vault {
  private readonly db: Database.Database;
  private readonly masterKey: Buffer;
  private _destroyed = false;

  constructor(config: GatewayConfig) {
    this.masterKey = config.masterKey;

    // Ensure the directory for the database file exists
    const dir = dirname(config.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    this.db = new Database(config.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    initializeDb(this.db);
  }

  // ── Private helpers for project/global lookup ──────────────

  /**
   * Resolve project: if provided and not _global, return it; otherwise _global.
   */
  private resolveProject(project?: string): string {
    return project && project !== GLOBAL_PROJECT ? project : GLOBAL_PROJECT;
  }

  /**
   * Find a credential row with project-first then global fallback.
   * Returns the decrypted value if found, or null if not found.
   */
  private findCredentialDecrypted(provider: string, keyName: string, project?: string): string | null {
    const resolved = this.resolveProject(project);

    const projectRow = this.db
      .prepare('SELECT encrypted_value, iv, auth_tag FROM credentials WHERE provider = ? AND key_name = ? AND project = ?')
      .get(provider, keyName, resolved) as Pick<CredentialRow, 'encrypted_value' | 'iv' | 'auth_tag'> | undefined;

    if (projectRow) {
      return this.decryptRow(projectRow);
    }

    // If project was specified and not _global, try global
    if (project && project !== GLOBAL_PROJECT) {
      const globalRow = this.db
        .prepare('SELECT encrypted_value, iv, auth_tag FROM credentials WHERE provider = ? AND key_name = ? AND project = ?')
        .get(provider, keyName, GLOBAL_PROJECT) as Pick<CredentialRow, 'encrypted_value' | 'iv' | 'auth_tag'> | undefined;
      if (globalRow) {
        return this.decryptRow(globalRow);
      }
    }

    return null;
  }

  /**
   * Check if a credential exists with project-first then global fallback.
   * Uses a single query with ORDER BY for efficient lookup.
   */
  private hasCredential(provider: string, keyName: string, project?: string): boolean {
    if (project && project !== GLOBAL_PROJECT) {
      // Single query: check project-specific first, then global fallback
      const row = this.db
        .prepare('SELECT project FROM credentials WHERE provider = ? AND key_name = ? AND project IN (?, ?) ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END LIMIT 1')
        .get(provider, keyName, project, GLOBAL_PROJECT, project);
      return !!row;
    }
    return !!this.db.prepare('SELECT 1 FROM credentials WHERE provider = ? AND key_name = ? AND project = ?').get(provider, keyName, GLOBAL_PROJECT);
  }

  /**
   * Find a file row with project-first then global fallback.
   * Returns the decrypted content if found, or null if not found.
   */
  private findFileDecrypted(provider: string, fileName: string, project?: string): string | null {
    const resolved = this.resolveProject(project);

    const projectRow = this.db
      .prepare('SELECT encrypted_value, iv, auth_tag FROM files WHERE provider = ? AND file_name = ? AND project = ?')
      .get(provider, fileName, resolved) as Pick<FileRow, 'encrypted_value' | 'iv' | 'auth_tag'> | undefined;

    if (projectRow) {
      return this.decryptRow(projectRow);
    }

    // If project was specified and not _global, try global
    if (project && project !== GLOBAL_PROJECT) {
      const globalRow = this.db
        .prepare('SELECT encrypted_value, iv, auth_tag FROM files WHERE provider = ? AND file_name = ? AND project = ?')
        .get(provider, fileName, GLOBAL_PROJECT) as Pick<FileRow, 'encrypted_value' | 'iv' | 'auth_tag'> | undefined;
      if (globalRow) {
        return this.decryptRow(globalRow);
      }
    }

    return null;
  }

  /**
   * Check if a file exists with project-first then global fallback.
   * Uses a single query with ORDER BY for efficient lookup.
   */
  private hasFileImpl(provider: string, fileName: string, project?: string): boolean {
    if (project && project !== GLOBAL_PROJECT) {
      // Single query: check project-specific first, then global fallback
      const row = this.db
        .prepare('SELECT project FROM files WHERE provider = ? AND file_name = ? AND project IN (?, ?) ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END LIMIT 1')
        .get(provider, fileName, project, GLOBAL_PROJECT, project);
      return !!row;
    }
    return !!this.db.prepare('SELECT 1 FROM files WHERE provider = ? AND file_name = ? AND project = ?').get(provider, fileName, GLOBAL_PROJECT);
  }

  /**
   * Decrypt an encrypted credential row.
   */
  private decryptRow(row: Pick<CredentialRow, 'encrypted_value' | 'iv' | 'auth_tag'>): string {
    return decrypt(
      {
        encrypted: row.encrypted_value,
        iv: row.iv,
        authTag: row.auth_tag,
      },
      this.masterKey,
    );
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Store (upsert) an encrypted credential.
   *
   * If a credential with the same (provider, keyName, project) already exists,
   * it is updated with the new encrypted value.
   *
   * @param project - Project scope (defaults to '_global')
   * @returns The row id of the stored credential
   */
  store(provider: string, keyName: string, apiKey: string, project?: string): number {
    const proj = project ?? GLOBAL_PROJECT;

    try {
      const { encrypted, iv, authTag } = encrypt(apiKey, this.masterKey);

      const stmt = this.db.prepare(`
        INSERT INTO credentials (provider, key_name, project, encrypted_value, iv, auth_tag, length_hint, updated_at)
        VALUES (@provider, @keyName, @project, @encrypted, @iv, @authTag, @lengthHint, datetime('now'))
        ON CONFLICT(provider, key_name, project) DO UPDATE SET
          encrypted_value = @encrypted,
          iv              = @iv,
          auth_tag        = @authTag,
          length_hint     = @lengthHint,
          updated_at      = datetime('now')
      `);

      const result = stmt.run({
        provider,
        keyName,
        project: proj,
        encrypted,
        iv,
        authTag,
        lengthHint: apiKey.length,
      });

      vaultAuditLogger.info({ action: 'store', provider, keyName, project: proj, success: true } satisfies VaultAuditEvent);
      return Number(result.lastInsertRowid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vaultAuditLogger.error({ action: 'store', provider, keyName, project: proj, success: false, error: message } satisfies VaultAuditEvent);
      throw err;
    }
  }

  /**
   * Retrieve and decrypt an API key.
   *
   * When a project is specified, tries project-specific first,
   * then falls back to '_global'.
   *
   * @param provider - Provider identifier (e.g. "anthropic", "openai")
   * @param keyName - Key slot name (defaults to "default")
   * @param project - Project scope (tries project-specific first, then '_global')
   * @throws Error if no credential is found for the given provider/keyName
   */
  getDecrypted(provider: string, keyName = 'default', project?: string): string {
    const proj = this.resolveProject(project);

    try {
      const decrypted = this.findCredentialDecrypted(provider, keyName, project);

      if (!decrypted) {
        const scopeInfo = project && project !== GLOBAL_PROJECT
          ? ` (checked project "${project}" and global)`
          : '';
        throw new Error(
          `No credential found for provider "${provider}" with key name "${keyName}"${scopeInfo}.`,
        );
      }

      vaultAuditLogger.info({ action: 'access', provider, keyName, project: proj, success: true } satisfies VaultAuditEvent);
      return decrypted;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vaultAuditLogger.error({ action: 'access', provider, keyName, project: proj, success: false, error: message } satisfies VaultAuditEvent);
      throw err;
    }
  }

  /**
   * Check whether a credential exists for the given provider/keyName.
   *
   * When a project is specified, checks project-specific first, then '_global'.
   */
  has(provider: string, keyName = 'default', project?: string): boolean {
    return this.hasCredential(provider, keyName, project);
  }

  /**
   * List all credentials with masked values (safe for display).
   *
   * If project is specified, returns project-specific + global credentials.
   * If not specified, returns all credentials.
   */
  listMasked(project?: string): MaskedCredential[] {
    const proj = project ?? GLOBAL_PROJECT;

    try {
      let rows: CredentialRow[];

      if (project) {
        rows = this.db
          .prepare(
            'SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag, created_at, updated_at FROM credentials WHERE project = ? OR project = ? ORDER BY provider, key_name, project',
          )
          .all(project, GLOBAL_PROJECT) as CredentialRow[];
      } else {
        rows = this.db
          .prepare(
            'SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag, created_at, updated_at FROM credentials ORDER BY provider, key_name, project',
          )
          .all() as CredentialRow[];
      }

      const result = rows.map((row) => {
        // Use length_hint for masking if available (lazy - no decryption needed)
        // Fall back to decrypting for existing records without length_hint
        let maskedValue: string;
        if (row.length_hint != null) {
          maskedValue = this.maskByLength(row.length_hint);
        } else {
          // Fallback: decrypt then mask (for legacy records)
          const decrypted = decrypt(
            {
              encrypted: row.encrypted_value,
              iv: row.iv,
              authTag: row.auth_tag,
            },
            this.masterKey,
          );
          maskedValue = this.mask(decrypted);
        }

        return {
          id: row.id,
          provider: row.provider,
          keyName: row.key_name,
          project: row.project,
          maskedValue,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      vaultAuditLogger.info({ action: 'list', provider: '*', project: proj, success: true } satisfies VaultAuditEvent);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vaultAuditLogger.error({ action: 'list', provider: '*', project: proj, success: false, error: message } satisfies VaultAuditEvent);
      throw err;
    }
  }

  /**
   * Delete a credential by its row id.
   * 
   * Authorization: Only allows deletion if the credential belongs to
   * the specified project (or is global), preventing IDOR attacks.
   * 
   * @param id - The credential row id
   * @param project - The project scope to authorize against (optional)
   * @throws Error if credential not found or unauthorized
   */
  delete(id: number, project?: string): void {
    // First, verify the credential exists and get its project
    const row = this.db
      .prepare('SELECT project, provider, key_name FROM credentials WHERE id = ?')
      .get(id) as { project: string; provider: string; key_name: string } | undefined;

    if (!row) {
      const err = new Error(`Credential not found: id ${id}`);
      vaultAuditLogger.error({ action: 'delete', provider: 'unknown', project: project ?? GLOBAL_PROJECT, success: false, error: err.message } satisfies VaultAuditEvent);
      throw err;
    }

    // Authorization check: allow deletion if same project or global
    const isGlobal = row.project === GLOBAL_PROJECT;
    const isSameProject = row.project === project;

    if (!isGlobal && !isSameProject) {
      const err = new Error(
        `Unauthorized: credential belongs to project "${row.project}", not "${project ?? '_global'}"`,
      );
      vaultAuditLogger.error({ action: 'delete', provider: row.provider, keyName: row.key_name, project: row.project, success: false, error: err.message } satisfies VaultAuditEvent);
      throw err;
    }

    this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
    vaultAuditLogger.info({ action: 'delete', provider: row.provider, keyName: row.key_name, project: row.project, success: true } satisfies VaultAuditEvent);
  }

  /**
   * Mask a value for safe display.
   *
   * Shows the first 7 characters followed by `...***`.
   * For short values (≤ 7 chars), shows proportionally less.
   */
  mask(value: string): string {
    if (value.length <= 4) {
      return '***';
    }
    const visible = Math.min(MASK_VISIBLE_CHARS, value.length - 3);
    return value.slice(0, visible) + MASK_SUFFIX;
  }

  /**
   * Mask a value based on its length (without needing the actual value).
   * Used for lazy masking when length_hint is available.
   */
  maskByLength(length: number): string {
    if (length <= 4) {
      return '***';
    }
    const visible = Math.min(MASK_VISIBLE_CHARS, length - 3);
    return '█'.repeat(visible) + MASK_SUFFIX;
  }

  // ── File Storage ──────────────────────────────────────────

  /**
   * Store (upsert) an encrypted file.
   *
   * If a file with the same (provider, fileName, project) already exists,
   * it is updated with the new encrypted content.
   *
   * @param provider - Provider identifier (e.g. "opencode")
   * @param fileName - File name (e.g. "auth.json")
   * @param content - File content as a string
   * @param project - Project scope (defaults to '_global')
   * @returns The row id of the stored file
   */
  storeFile(provider: string, fileName: string, content: string, project?: string): number {
    const proj = project ?? GLOBAL_PROJECT;

    try {
      const { encrypted, iv, authTag } = encrypt(content, this.masterKey);

      const stmt = this.db.prepare(`
        INSERT INTO files (provider, file_name, project, encrypted_value, iv, auth_tag, updated_at)
        VALUES (@provider, @fileName, @project, @encrypted, @iv, @authTag, datetime('now'))
        ON CONFLICT(provider, file_name, project) DO UPDATE SET
          encrypted_value = @encrypted,
          iv              = @iv,
          auth_tag        = @authTag,
          updated_at      = datetime('now')
      `);

      const result = stmt.run({
        provider,
        fileName,
        project: proj,
        encrypted,
        iv,
        authTag,
      });

      vaultAuditLogger.info({ action: 'store_file', provider, fileName, project: proj, success: true } satisfies VaultAuditEvent);
      return Number(result.lastInsertRowid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vaultAuditLogger.error({ action: 'store_file', provider, fileName, project: proj, success: false, error: message } satisfies VaultAuditEvent);
      throw err;
    }
  }

  /**
   * Retrieve and decrypt a stored file.
   *
   * When a project is specified, tries project-specific first,
   * then falls back to '_global'.
   *
   * @returns Decrypted file content, or null if not found
   */
  getFile(provider: string, fileName: string, project?: string): string | null {
    return this.findFileDecrypted(provider, fileName, project);
  }

  /**
   * Check whether a file exists for the given provider/fileName.
   *
   * When a project is specified, checks project-specific first, then '_global'.
   */
  hasFile(provider: string, fileName: string, project?: string): boolean {
    return this.hasFileImpl(provider, fileName, project);
  }

  /**
   * Delete a stored file by its row id.
   * 
   * Authorization: Only allows deletion if the file belongs to
   * the specified project (or is global), preventing IDOR attacks.
   * 
   * @param id - The file row id
   * @param project - The project scope to authorize against (optional)
   * @throws Error if file not found or unauthorized
   */
  deleteFile(id: number, project?: string): void {
    // First, verify the file exists and get its project
    const row = this.db
      .prepare('SELECT project, provider, file_name FROM files WHERE id = ?')
      .get(id) as { project: string; provider: string; file_name: string } | undefined;

    if (!row) {
      const err = new Error(`File not found: id ${id}`);
      vaultAuditLogger.error({ action: 'delete_file', provider: 'unknown', project: project ?? GLOBAL_PROJECT, success: false, error: err.message } satisfies VaultAuditEvent);
      throw err;
    }

    // Authorization check: allow deletion if same project or global
    const isGlobal = row.project === GLOBAL_PROJECT;
    const isSameProject = row.project === project;

    if (!isGlobal && !isSameProject) {
      const err = new Error(
        `Unauthorized: file belongs to project "${row.project}", not "${project ?? '_global'}"`,
      );
      vaultAuditLogger.error({ action: 'delete_file', provider: row.provider, fileName: row.file_name, project: row.project, success: false, error: err.message } satisfies VaultAuditEvent);
      throw err;
    }

    this.db.prepare('DELETE FROM files WHERE id = ?').run(id);
    vaultAuditLogger.info({ action: 'delete_file', provider: row.provider, fileName: row.file_name, project: row.project, success: true } satisfies VaultAuditEvent);
  }

  /**
   * List all stored files (metadata only, no content).
   *
   * If project is specified, returns project-specific + global files.
   * If not specified, returns all files.
   */
  listFiles(project?: string): StoredFile[] {
    let rows: FileRow[];

    if (project) {
      rows = this.db
        .prepare(
          'SELECT id, provider, file_name, project, created_at FROM files WHERE project = ? OR project = ? ORDER BY provider, file_name, project',
        )
        .all(project, GLOBAL_PROJECT) as FileRow[];
    } else {
      rows = this.db
        .prepare(
          'SELECT id, provider, file_name, project, created_at FROM files ORDER BY provider, file_name, project',
        )
        .all() as FileRow[];
    }

    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      fileName: row.file_name,
      project: row.project,
      createdAt: row.created_at,
    }));
  }

  /**
   * List stored files for a single provider.
   *
   * If project is specified, returns project-specific files first and then
   * global files that are not overridden by project-specific filenames.
   * If no project is specified, returns only global files for the provider.
   */
  listProviderFiles(provider: string, project?: string): StoredFile[] {
    if (project && project !== GLOBAL_PROJECT) {
      const rows = this.db
        .prepare(
          'SELECT id, provider, file_name, project, created_at FROM files WHERE provider = ? AND (project = ? OR project = ?) ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END, file_name',
        )
        .all(provider, project, GLOBAL_PROJECT, project) as Array<Pick<FileRow, 'id' | 'provider' | 'file_name' | 'project' | 'created_at'>>;

      const seen = new Set<string>();
      const result: StoredFile[] = [];

      for (const row of rows) {
        if (seen.has(row.file_name)) {
          continue;
        }
        seen.add(row.file_name);
        result.push({
          id: row.id,
          provider: row.provider,
          fileName: row.file_name,
          project: row.project,
          createdAt: row.created_at,
        });
      }

      return result;
    }

    const rows = this.db
      .prepare(
        'SELECT id, provider, file_name, project, created_at FROM files WHERE provider = ? AND project = ? ORDER BY file_name',
      )
      .all(provider, GLOBAL_PROJECT) as Array<Pick<FileRow, 'id' | 'provider' | 'file_name' | 'project' | 'created_at'>>;

    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      fileName: row.file_name,
      project: row.project,
      createdAt: row.created_at,
    }));
  }

  /**
   * Retrieve decrypted files for a single provider.
   *
   * If project is specified, project-specific files override global files
   * with the same filename. If no project is specified, only global files
   * are returned.
   */
  getProviderFiles(provider: string, project?: string): Array<{ fileName: string; content: string; project: string }> {
    if (project && project !== GLOBAL_PROJECT) {
      const rows = this.db
        .prepare(
          'SELECT file_name, project, encrypted_value, iv, auth_tag FROM files WHERE provider = ? AND (project = ? OR project = ?) ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END, file_name',
        )
        .all(provider, project, GLOBAL_PROJECT, project) as Array<Pick<FileRow, 'file_name' | 'project' | 'encrypted_value' | 'iv' | 'auth_tag'>>;

      const seen = new Set<string>();
      const result: Array<{ fileName: string; content: string; project: string }> = [];

      for (const row of rows) {
        if (seen.has(row.file_name)) {
          continue;
        }
        seen.add(row.file_name);
        result.push({
          fileName: row.file_name,
          content: decrypt(
            {
              encrypted: row.encrypted_value,
              iv: row.iv,
              authTag: row.auth_tag,
            },
            this.masterKey,
          ),
          project: row.project,
        });
      }

      return result;
    }

    const rows = this.db
      .prepare(
        'SELECT file_name, project, encrypted_value, iv, auth_tag FROM files WHERE provider = ? AND project = ? ORDER BY file_name',
      )
      .all(provider, GLOBAL_PROJECT) as Array<Pick<FileRow, 'file_name' | 'project' | 'encrypted_value' | 'iv' | 'auth_tag'>>;

    return rows.map((row) => ({
      fileName: row.file_name,
      content: decrypt(
        {
          encrypted: row.encrypted_value,
          iv: row.iv,
          authTag: row.auth_tag,
        },
        this.masterKey,
      ),
      project: row.project,
    }));
  }

  // ── Claude CLI OAuth Integration ─────────────────────────────

  /**
   * Get Claude OAuth token from CLI credentials, with automatic refresh and sync.
   *
   * This method:
   * 1. Reads the OAuth token from ~/.claude/.credentials.json
   * 2. Checks if the token needs refresh (within 5 minutes of expiry)
   * 3. Attempts refresh if needed
   * 4. Syncs the credentials to ~/.local/share/opencode/auth.json
   * 5. Returns the access token
   *
   * @param project - Optional project identifier (for future multi-tenant use)
   * @returns The OAuth access token, or null if not available
   */
  async getClaudeOAuthToken(project?: string): Promise<TokenInfo | null> {
    // Read token from Claude CLI credentials
    let token = readClaudeOAuthToken();

    if (!token) {
      return null;
    }

    // Check if token needs refresh
    if (token.refreshToken) {
      try {
        token = await refreshTokenIfNeeded(token);
      } catch (error) {
        // Log but continue with existing token
        console.warn('[vault] Token refresh failed, using existing token:', error);
      }
    }

    // Sync to opencode auth.json
    syncToOpencodeAuth(token, project);

    return token;
  }

  /**
   * Get Claude OAuth token synchronously (without refresh).
   *
   * Use this for quick lookups where you don't want async overhead.
   * Does not trigger refresh or sync.
   *
   * @returns The OAuth access token, or null if not available
   */
  getClaudeOAuthTokenSync(): string | null {
    const token = readClaudeOAuthToken();
    return token?.accessToken ?? null;
  }

  /**
   * Whether this vault has been destroyed (master key zeroed).
   */
  get destroyed(): boolean {
    return this._destroyed;
  }

  /**
   * Close the underlying database connection.
   * @deprecated Use {@link destroy} instead to also zero the master key.
   */
  close(): void {
    this.destroy();
  }

  /**
   * Zero the in-memory master key and close the database.
   *
   * After calling this method the Vault instance is no longer usable —
   * any attempt to encrypt or decrypt will fail because the key material
   * has been overwritten with zeroes.
   *
   * Idempotent: calling destroy() more than once is safe.
   */
  destroy(): void {
    if (!this._destroyed) {
      this.masterKey.fill(0);
      this._destroyed = true;
    }
    this.db.close();
  }
}
