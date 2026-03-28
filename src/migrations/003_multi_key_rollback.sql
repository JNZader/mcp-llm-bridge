-- Migration 003 Rollback: Remove Multi-Key columns

-- Drop indexes first
DROP INDEX IF EXISTS idx_credentials_cooldown;
DROP INDEX IF EXISTS idx_credentials_priority;
DROP INDEX IF EXISTS idx_credentials_project_provider;

-- SQLite doesn't support dropping columns directly, so we recreate the table
-- This is a simplified rollback that preserves core data

CREATE TABLE credentials_backup (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider        TEXT NOT NULL,
  key_name        TEXT NOT NULL DEFAULT 'default',
  project         TEXT NOT NULL DEFAULT '_global',
  encrypted_value BLOB NOT NULL,
  iv              BLOB NOT NULL,
  auth_tag        BLOB NOT NULL,
  length_hint     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, key_name, project)
);

-- Copy core data only (multi-key columns are dropped)
INSERT INTO credentials_backup 
  SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag, length_hint, created_at, updated_at 
  FROM credentials;

DROP TABLE credentials;
ALTER TABLE credentials_backup RENAME TO credentials;
