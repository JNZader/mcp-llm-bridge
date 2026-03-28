-- Migration 004_model_sync.sql
-- Auto Model Sync feature schema

-- Provider models table - stores discovered models from providers
CREATE TABLE IF NOT EXISTS provider_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT,
  model_description TEXT,
  context_length INTEGER,
  pricing_input REAL,
  pricing_output REAL,
  discovered_at INTEGER,
  last_synced_at INTEGER,
  is_active BOOLEAN DEFAULT 1,
  match_regex TEXT, -- User-defined regex to filter
  UNIQUE(provider, model_id)
);

-- Index for faster provider queries
CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider);

-- Index for active model filtering
CREATE INDEX IF NOT EXISTS idx_provider_models_active ON provider_models(is_active);

-- Track sync history
CREATE TABLE IF NOT EXISTS model_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  synced_at INTEGER,
  models_found INTEGER,
  models_added INTEGER,
  models_removed INTEGER,
  error TEXT
);

-- Index for sync history queries
CREATE INDEX IF NOT EXISTS idx_model_sync_log_provider ON model_sync_log(provider);
CREATE INDEX IF NOT EXISTS idx_model_sync_log_synced_at ON model_sync_log(synced_at);
