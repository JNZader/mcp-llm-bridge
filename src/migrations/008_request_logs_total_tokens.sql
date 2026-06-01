-- Migration: 008_request_logs_total_tokens
-- Description: Add truthful total token tracking to request logs
-- Created: 2026-06-01

ALTER TABLE request_logs ADD COLUMN total_tokens INTEGER;

UPDATE request_logs
SET total_tokens = input_tokens + output_tokens
WHERE input_tokens IS NOT NULL AND output_tokens IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations (version, name, checksum)
VALUES (8, '008_request_logs_total_tokens', 'request_logs_total_tokens_v1');
