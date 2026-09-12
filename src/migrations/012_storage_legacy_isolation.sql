-- Migration: 012_storage_legacy_isolation
-- Isolate historical raw telemetry before protected storage becomes routine.

ALTER TABLE request_logs RENAME TO request_logs_legacy;
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  key_name TEXT NOT NULL DEFAULT 'default',
  model TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '_global',
  user_id TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE usage_logs RENAME TO usage_logs_legacy;
ALTER TABLE comparison_results RENAME TO comparison_results_legacy;

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
CREATE INDEX idx_protected_logs_timestamp ON request_logs(timestamp);
CREATE INDEX idx_protected_logs_provider ON request_logs(provider);
CREATE INDEX idx_protected_logs_model ON request_logs(model);

CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  error_code TEXT CHECK (error_code IS NULL OR error_code IN ('rate_limited', 'timed_out', 'unavailable', 'failed')),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN ('client', 'provider', 'transient')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_protected_usage_provider_time ON usage_logs(provider, created_at);
CREATE INDEX idx_protected_usage_model_time ON usage_logs(model, created_at);

CREATE TABLE comparison_results (
  id TEXT PRIMARY KEY,
  models TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '_global',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_protected_comparison_project ON comparison_results(project);
CREATE INDEX idx_protected_comparison_created ON comparison_results(created_at);

CREATE TABLE authorized_comparison_results (
  id TEXT PRIMARY KEY REFERENCES comparison_results(id),
  prompt TEXT NOT NULL,
  system_prompt TEXT,
  results TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
