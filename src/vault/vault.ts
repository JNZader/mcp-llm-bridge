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

import type { GatewayConfig, MaskedCredential } from '../core/types.js';
import { encrypt, decrypt } from './crypto.js';
import { GLOBAL_PROJECT, initializeDb } from './schema.js';

/** Minimum characters to show unmasked in masked output. */
const MASK_VISIBLE_CHARS = 7;
const MASK_SUFFIX = '...***';

/** Row shape returned by SELECT queries on the credentials table. */
interface CredentialRow {
  id: number;
  provider: string;
  key_name: string;
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
    const { encrypted, iv, authTag } = encrypt(apiKey, this.masterKey);

    const stmt = this.db.prepare(`
      INSERT INTO credentials (provider, key_name, project, encrypted_value, iv, auth_tag, updated_at)
      VALUES (@provider, @keyName, @project, @encrypted, @iv, @authTag, datetime('now'))
      ON CONFLICT(provider, key_name, project) DO UPDATE SET
        encrypted_value = @encrypted,
        iv              = @iv,
        auth_tag        = @authTag,
        updated_at      = datetime('now')
    `);

    const result = stmt.run({
      provider,
      keyName,
      project: proj,
      encrypted,
      iv,
      authTag,
    });

    return Number(result.lastInsertRowid);
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
    // If a project is specified and it's not _global, try project-specific first
    if (project && project !== GLOBAL_PROJECT) {
      const projectRow = this.db
        .prepare(
          'SELECT encrypted_value, iv, auth_tag FROM credentials WHERE provider = ? AND key_name = ? AND project = ?',
        )
        .get(provider, keyName, project) as Pick<CredentialRow, 'encrypted_value' | 'iv' | 'auth_tag'> | undefined;

      if (projectRow) {
        return decrypt(
          {
            encrypted: projectRow.encrypted_value,
            iv: projectRow.iv,
            authTag: projectRow.auth_tag,
          },
          this.masterKey,
        );
      }
    }

    // Fall back to global
    const row = this.db
      .prepare(
        'SELECT encrypted_value, iv, auth_tag FROM credentials WHERE provider = ? AND key_name = ? AND project = ?',
      )
      .get(provider, keyName, GLOBAL_PROJECT) as Pick<CredentialRow, 'encrypted_value' | 'iv' | 'auth_tag'> | undefined;

    if (!row) {
      const scopeInfo = project && project !== GLOBAL_PROJECT
        ? ` (checked project "${project}" and global)`
        : '';
      throw new Error(
        `No credential found for provider "${provider}" with key name "${keyName}"${scopeInfo}.`,
      );
    }

    return decrypt(
      {
        encrypted: row.encrypted_value,
        iv: row.iv,
        authTag: row.auth_tag,
      },
      this.masterKey,
    );
  }

  /**
   * Check whether a credential exists for the given provider/keyName.
   *
   * When a project is specified, checks project-specific first, then '_global'.
   */
  has(provider: string, keyName = 'default', project?: string): boolean {
    // If a project is specified and it's not _global, check project-specific first
    if (project && project !== GLOBAL_PROJECT) {
      const projectRow = this.db
        .prepare(
          'SELECT 1 FROM credentials WHERE provider = ? AND key_name = ? AND project = ?',
        )
        .get(provider, keyName, project);

      if (projectRow !== undefined) {
        return true;
      }
    }

    // Fall back to global
    const row = this.db
      .prepare(
        'SELECT 1 FROM credentials WHERE provider = ? AND key_name = ? AND project = ?',
      )
      .get(provider, keyName, GLOBAL_PROJECT);

    return row !== undefined;
  }

  /**
   * List all credentials with masked values (safe for display).
   *
   * If project is specified, returns project-specific + global credentials.
   * If not specified, returns all credentials.
   */
  listMasked(project?: string): MaskedCredential[] {
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

    return rows.map((row) => {
      const decrypted = decrypt(
        {
          encrypted: row.encrypted_value,
          iv: row.iv,
          authTag: row.auth_tag,
        },
        this.masterKey,
      );

      return {
        id: row.id,
        provider: row.provider,
        keyName: row.key_name,
        project: row.project,
        maskedValue: this.mask(decrypted),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  /**
   * Delete a credential by its row id.
   */
  delete(id: number): void {
    this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
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
   * Close the underlying database connection.
   */
  close(): void {
    this.db.close();
  }
}
