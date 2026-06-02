-- Migration: 011_analytics_total_tokens
-- Description: Add truthful total token tracking to durable analytics buckets
-- Created: 2026-06-02

ALTER TABLE analytics_hourly ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;

UPDATE analytics_hourly
SET total_tokens = input_tokens + output_tokens
WHERE total_tokens = 0;

ALTER TABLE analytics_daily ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;

UPDATE analytics_daily
SET total_tokens = input_tokens + output_tokens
WHERE total_tokens = 0;

INSERT OR IGNORE INTO schema_migrations (version, name, checksum)
VALUES (11, '011_analytics_total_tokens', 'analytics_total_tokens_v1');
