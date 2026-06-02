-- Migration: 010_request_logs_correlation_id
-- Description: Add HTTP correlation ID tracking to request logs
-- Created: 2026-06-02

ALTER TABLE request_logs ADD COLUMN correlation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_logs_correlation_id ON request_logs(correlation_id);

INSERT OR IGNORE INTO schema_migrations (version, name, checksum)
VALUES (10, '010_request_logs_correlation_id', 'request_logs_correlation_id_v1');
