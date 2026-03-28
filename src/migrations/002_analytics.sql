-- Migration: 002_analytics
-- Description: Create analytics tables for 6-dimensional tracking
-- Created: 2026-03-28

-- Analytics - hourly aggregation
CREATE TABLE IF NOT EXISTS analytics_hourly (
  hour INTEGER PRIMARY KEY, -- Unix timestamp of hour start
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  p99_latency_ms INTEGER
);

-- Analytics - daily aggregation
CREATE TABLE IF NOT EXISTS analytics_daily (
  day INTEGER PRIMARY KEY, -- Unix timestamp of day start
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER,
  p95_latency_ms INTEGER,
  p99_latency_ms INTEGER
);

-- Analytics - by channel/provider
CREATE TABLE IF NOT EXISTS analytics_channel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER,
  UNIQUE(channel_id, timestamp)
);

-- Analytics - by model
CREATE TABLE IF NOT EXISTS analytics_model (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER,
  UNIQUE(model, timestamp)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_analytics_channel_time ON analytics_channel(channel_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_analytics_model_time ON analytics_model(model, timestamp);

-- Record this migration
INSERT OR IGNORE INTO schema_migrations (version, name, checksum)
VALUES (2, '002_analytics', '6dimensional_analytics_v1');
