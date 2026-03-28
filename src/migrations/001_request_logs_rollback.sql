-- Rollback: 001_request_logs
-- Description: Remove request_logs table and related indexes

-- Drop indexes first
DROP INDEX IF EXISTS idx_logs_timestamp;
DROP INDEX IF EXISTS idx_logs_provider;
DROP INDEX IF EXISTS idx_logs_model;

-- Drop the main table
DROP TABLE IF EXISTS request_logs;

-- Remove migration record
DELETE FROM schema_migrations WHERE version = 1;
