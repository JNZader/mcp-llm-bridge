-- Migration 003: Multi-Key per Provider with cooldown and rotation support
-- Adds columns for key priority, cooldown tracking, usage statistics

-- Add key_priority column for priority-based selection (lower = higher priority)
ALTER TABLE credentials ADD COLUMN key_priority INTEGER DEFAULT 0;

-- Add cooldown_until column (Unix timestamp in ms) - when key should become available again
ALTER TABLE credentials ADD COLUMN cooldown_until INTEGER;

-- Add last_used_at column (Unix timestamp in ms) for LRU rotation
ALTER TABLE credentials ADD COLUMN last_used_at INTEGER;

-- Add request_count column for usage tracking
ALTER TABLE credentials ADD COLUMN request_count INTEGER DEFAULT 0;

-- Add error_count column for error rate tracking
ALTER TABLE credentials ADD COLUMN error_count INTEGER DEFAULT 0;

-- Add consecutive_errors column for backoff escalation
ALTER TABLE credentials ADD COLUMN consecutive_errors INTEGER DEFAULT 0;

-- Indexes for efficient key selection queries
CREATE INDEX IF NOT EXISTS idx_credentials_cooldown ON credentials(provider, cooldown_until);
CREATE INDEX IF NOT EXISTS idx_credentials_priority ON credentials(provider, key_priority);
CREATE INDEX IF NOT EXISTS idx_credentials_project_provider ON credentials(project, provider);
