-- Rollback 007_comparison.sql
-- Drop comparison_results table

DROP INDEX IF EXISTS idx_comparison_created;
DROP INDEX IF EXISTS idx_comparison_project;
DROP TABLE IF EXISTS comparison_results;
