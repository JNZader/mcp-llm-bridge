/**
 * SQLite schema initialization for the credential vault.
 *
 * Creates the `credentials` table with a unique constraint on
 * (provider, key_name, project) to support per-project credential scoping.
 * Creates the `files` table for encrypted file storage (e.g. auth.json).
 * Handles migration from the old schema (without project column).
 */

import type Database from 'better-sqlite3';

// Re-export for backward compatibility
export { GLOBAL_PROJECT } from '../core/constants.js';
import { GLOBAL_PROJECT } from '../core/constants.js';

/**
 * Create the credentials table if it does not already exist,
 * and migrate from the old schema if needed.
 *
 * @param db - An open better-sqlite3 Database instance
 */
export function initializeDb(db: Database.Database): void {
  // Check if the table already exists
  const tableExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='credentials'",
    )
    .get();

  if (tableExists) {
    // Check if the project column exists
    const columns = db.pragma('table_info(credentials)') as Array<{ name: string }>;
    const hasProject = columns.some((col) => col.name === 'project');

    // Check if length_hint column exists (added for lazy masking)
    const hasLengthHint = columns.some((col) => col.name === 'length_hint');

    if (!hasProject) {
      // Migrate: add project column with default '_global'
      db.exec(`ALTER TABLE credentials ADD COLUMN project TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}'`);

      // Drop the old unique constraint and create new one.
      // SQLite doesn't support DROP CONSTRAINT, so we recreate via a new unique index.
      // The old UNIQUE(provider, key_name) is embedded in the table definition,
      // but we can create a new unique index that supersedes it for our queries.
      // We need to rebuild the table to change the constraint.
      db.exec(`
        CREATE TABLE IF NOT EXISTS credentials_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          provider        TEXT NOT NULL,
          key_name        TEXT NOT NULL DEFAULT 'default',
          project         TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
          encrypted_value BLOB NOT NULL,
          iv              BLOB NOT NULL,
          auth_tag        BLOB NOT NULL,
          length_hint     INTEGER,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(provider, key_name, project)
        );

        INSERT INTO credentials_new (id, provider, key_name, project, encrypted_value, iv, auth_tag, length_hint, created_at, updated_at)
          SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag, NULL, created_at, updated_at
          FROM credentials;

        DROP TABLE credentials;

        ALTER TABLE credentials_new RENAME TO credentials;
      `);
    }

    // Add length_hint column if missing (for lazy masking without decryption)
    if (!hasLengthHint) {
      db.exec(`ALTER TABLE credentials ADD COLUMN length_hint INTEGER`);
    }
  } else {
    // Fresh install — create table with project column and length_hint
    db.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        provider        TEXT NOT NULL,
        key_name        TEXT NOT NULL DEFAULT 'default',
        project         TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
        encrypted_value BLOB NOT NULL,
        iv              BLOB NOT NULL,
        auth_tag        BLOB NOT NULL,
        length_hint     INTEGER,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider, key_name, project)
      );
    `);
  }

  // ── Files table (for auth.json and similar config files) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      provider        TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      project         TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
      encrypted_value BLOB NOT NULL,
      iv              BLOB NOT NULL,
      auth_tag        BLOB NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, file_name, project)
    );
  `);

  // ── Usage logs table (Phase 4: Cost Tracking) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      provider    TEXT NOT NULL,
      key_name    TEXT NOT NULL DEFAULT 'default',
      model       TEXT NOT NULL,
      project     TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
      tokens_in   INTEGER NOT NULL DEFAULT 0,
      tokens_out  INTEGER NOT NULL DEFAULT 0,
      cost_usd    REAL NOT NULL DEFAULT 0.0,
      latency_ms  INTEGER NOT NULL DEFAULT 0,
      success     INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_usage_provider_time ON usage_logs(provider, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_model_time ON usage_logs(model, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_project_time ON usage_logs(project, created_at);
  `);

  // ── Price config table (Phase 4: Cost Tracking) ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_config (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      provider        TEXT NOT NULL,
      model           TEXT NOT NULL,
      input_per_mtok  REAL NOT NULL,
      output_per_mtok REAL NOT NULL,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, model)
    );
  `);
}
