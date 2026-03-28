-- Migration: 001_request_logs
-- Description: Create request_logs table for logging LLM requests
-- Created: 2026-03-28

-- Main table for request logging
CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost REAL,
    latency_ms INTEGER,
    error TEXT,
    attempts INTEGER DEFAULT 1,
    request_data TEXT,
    response_data TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_provider ON request_logs(provider);
CREATE INDEX IF NOT EXISTS idx_logs_model ON request_logs(model);

-- Migration tracking table (if not exists)
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER DEFAULT (strftime('%s', 'now')),
    checksum TEXT
);

-- Record this migration
INSERT OR IGNORE INTO schema_migrations (version, name, checksum)
VALUES (1, '001_request_logs', 'phase1_observability_v1');
