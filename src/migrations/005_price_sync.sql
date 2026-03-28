-- Migration 005_price_sync.sql
-- Price Sync feature schema - automatic pricing from models.dev

-- Model pricing table
CREATE TABLE IF NOT EXISTS model_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT,
  input_price REAL,        -- per 1M tokens
  output_price REAL,       -- per 1M tokens
  cache_read_price REAL,   -- per 1M tokens (Anthropic)
  cache_write_price REAL,  -- per 1M tokens (Anthropic)
  currency TEXT DEFAULT 'USD',
  source TEXT,             -- 'models.dev' or 'manual'
  updated_at INTEGER,
  is_overridden BOOLEAN DEFAULT 0, -- User override flag
  UNIQUE(provider, model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider);
CREATE INDEX IF NOT EXISTS idx_model_pricing_overridden ON model_pricing(is_overridden);

-- Price sync history
CREATE TABLE IF NOT EXISTS price_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  synced_at INTEGER,
  models_updated INTEGER,
  models_added INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_price_sync_log_synced_at ON price_sync_log(synced_at);
