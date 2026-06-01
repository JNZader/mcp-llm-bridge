-- Migration: 009_analytics_health_counters
-- Description: Add success/failure/retry counters to durable analytics buckets
-- Created: 2026-06-01

ALTER TABLE analytics_hourly ADD COLUMN successful_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_hourly ADD COLUMN failed_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_hourly ADD COLUMN retried_requests INTEGER NOT NULL DEFAULT 0;

UPDATE analytics_hourly
SET successful_requests = requests
WHERE successful_requests = 0 AND failed_requests = 0;

ALTER TABLE analytics_daily ADD COLUMN successful_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_daily ADD COLUMN failed_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_daily ADD COLUMN retried_requests INTEGER NOT NULL DEFAULT 0;

UPDATE analytics_daily
SET successful_requests = requests
WHERE successful_requests = 0 AND failed_requests = 0;

INSERT OR IGNORE INTO schema_migrations (version, name, checksum)
VALUES (9, '009_analytics_health_counters', 'analytics_health_counters_v1');
