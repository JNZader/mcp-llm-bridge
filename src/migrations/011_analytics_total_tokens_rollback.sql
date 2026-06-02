-- Rollback: 011_analytics_total_tokens
-- SQLite cannot drop columns in-place here; keep total_tokens if rollback is requested.

DELETE FROM schema_migrations WHERE version = 11;
