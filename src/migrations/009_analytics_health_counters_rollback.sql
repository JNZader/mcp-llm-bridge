-- Rollback: 009_analytics_health_counters
-- SQLite cannot drop columns in-place here; keep counters if rollback is requested.

DELETE FROM schema_migrations WHERE version = 9;
