/**
 * SQLite schema initialization for the credential vault.
 *
 * Creates the `credentials` table with a unique constraint on
 * (provider, key_name) to support one key per provider per name slot.
 */

import type Database from 'better-sqlite3';

/**
 * Create the credentials table if it does not already exist.
 *
 * @param db - An open better-sqlite3 Database instance
 */
export function initializeDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      provider        TEXT NOT NULL,
      key_name        TEXT NOT NULL DEFAULT 'default',
      encrypted_value BLOB NOT NULL,
      iv              BLOB NOT NULL,
      auth_tag        BLOB NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, key_name)
    );
  `);
}
