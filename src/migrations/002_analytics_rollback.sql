-- Rollback: 002_analytics
-- Description: Remove analytics tables and related indexes

-- Drop indexes first
DROP INDEX IF EXISTS idx_analytics_channel_time;
DROP INDEX IF EXISTS idx_analytics_model_time;

-- Drop the tables
DROP TABLE IF EXISTS analytics_hourly;
DROP TABLE IF EXISTS analytics_daily;
DROP TABLE IF EXISTS analytics_channel;
DROP TABLE IF EXISTS analytics_model;

-- Remove migration record
DELETE FROM schema_migrations WHERE version = 2;
