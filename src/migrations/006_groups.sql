-- Migration 006_groups.sql
-- Groups feature schema - unified model names with multi-channel routing

-- Groups table: unified model names
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, -- Exposed model name (e.g., "gpt-4o")
  description TEXT,
  mode TEXT DEFAULT 'round_robin', -- Load balancing mode
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Group channels: assignments of credentials to groups
CREATE TABLE IF NOT EXISTS group_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL, -- Reference to credentials.id
  model_override TEXT, -- Use different model name at this channel
  priority INTEGER DEFAULT 0, -- For failover mode (lower = higher priority)
  weight INTEGER DEFAULT 1, -- For weighted mode
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES credentials(id) ON DELETE CASCADE,
  UNIQUE(group_id, channel_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name);
CREATE INDEX IF NOT EXISTS idx_group_channels_group ON group_channels(group_id);
CREATE INDEX IF NOT EXISTS idx_group_channels_active ON group_channels(is_active);

-- Migration rollback script (006_groups_rollback.sql)
-- DROP INDEX IF EXISTS idx_group_channels_active;
-- DROP INDEX IF EXISTS idx_group_channels_group;
-- DROP INDEX IF EXISTS idx_groups_name;
-- DROP TABLE IF EXISTS group_channels;
-- DROP TABLE IF EXISTS groups;
