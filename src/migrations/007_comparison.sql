-- Migration 007_comparison.sql
-- Comparison results table for multi-model comparison endpoint

CREATE TABLE IF NOT EXISTS comparison_results (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  system_prompt TEXT,
  models TEXT NOT NULL,
  results TEXT NOT NULL,
  summary TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '_global',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comparison_project ON comparison_results(project);
CREATE INDEX IF NOT EXISTS idx_comparison_created ON comparison_results(created_at);
