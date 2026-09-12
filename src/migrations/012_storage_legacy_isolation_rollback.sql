-- Rollback: 012_storage_legacy_isolation
-- Remove the migration ledger entry without restoring unsafe raw storage.

DROP INDEX IF EXISTS idx_protected_logs_timestamp;
DROP INDEX IF EXISTS idx_protected_logs_provider;
DROP INDEX IF EXISTS idx_protected_logs_model;
DROP INDEX IF EXISTS idx_protected_usage_provider_time;
DROP INDEX IF EXISTS idx_protected_usage_model_time;
DROP INDEX IF EXISTS idx_protected_comparison_project;
DROP INDEX IF EXISTS idx_protected_comparison_created;
ALTER TABLE authorized_comparison_results RENAME TO authorized_comparison_results_rollback_archive;
DROP TABLE IF EXISTS request_logs;
DROP TABLE IF EXISTS usage_logs;
DROP TABLE IF EXISTS comparison_results;
CREATE TABLE request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  correlation_id TEXT,
  total_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost REAL,
  latency_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 1,
  error TEXT CHECK (error IS NULL OR error IN ('rate_limited', 'timed_out', 'unavailable', 'failed')),
  error_code TEXT,
  error_category TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE comparison_results (
  id TEXT PRIMARY KEY,
  models TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '_global',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
DELETE FROM schema_migrations WHERE version = 12;
