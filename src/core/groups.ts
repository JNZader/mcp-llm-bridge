/**
 * Provider Groups — named collections of providers with load balancing.
 *
 * A group binds a set of providers to a balancing strategy and
 * optionally to specific models via glob patterns.
 *
 * Storage: SQLite table `provider_groups` in the existing vault DB.
 * Runtime: in-memory Map for fast lookups during routing.
 */

import { z } from 'zod';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Zod Schemas ────────────────────────────────────────────

export const BalancerStrategySchema = z.enum([
  'round-robin',
  'random',
  'failover',
  'weighted',
]);

export type BalancerStrategy = z.infer<typeof BalancerStrategySchema>;

export const GroupMemberSchema = z.object({
  provider: z.string().min(1),
  keyName: z.string().optional(),
  weight: z.number().positive().optional(),
  priority: z.number().int().nonnegative().optional(),
});

export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const ProviderGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  modelPattern: z.string().optional(),
  members: z.array(GroupMemberSchema).min(1),
  strategy: BalancerStrategySchema,
  weights: z.record(z.string(), z.number().positive()).optional(),
  stickyTTL: z.number().int().positive().optional(),
});

export type ProviderGroup = z.infer<typeof ProviderGroupSchema>;

/** Schema for creating a group (id is auto-generated if omitted). */
export const CreateGroupSchema = z.object({
  name: z.string().min(1),
  modelPattern: z.string().optional(),
  members: z.array(GroupMemberSchema).min(1),
  strategy: BalancerStrategySchema,
  weights: z.record(z.string(), z.number().positive()).optional(),
  stickyTTL: z.number().int().positive().optional(),
});

export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

/** Schema for updating a group (all fields optional). */
export const UpdateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  modelPattern: z.string().optional(),
  members: z.array(GroupMemberSchema).min(1).optional(),
  strategy: BalancerStrategySchema.optional(),
  weights: z.record(z.string(), z.number().positive()).optional(),
  stickyTTL: z.number().int().positive().optional(),
});

export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;

// ── SQLite Row Shape ───────────────────────────────────────

interface GroupRow {
  id: string;
  name: string;
  model_pattern: string | null;
  members_json: string;
  strategy: string;
  weights_json: string | null;
  sticky_ttl: number | null;
  created_at: string;
  updated_at: string;
}

// ── GroupStore ──────────────────────────────────────────────

/**
 * Persistent group storage backed by SQLite.
 *
 * Follows the same patterns as vault.ts:
 * - WAL mode for concurrent reads
 * - Prepared statements for queries
 * - In-memory cache refreshed on write
 */
export class GroupStore {
  private readonly db: Database.Database;
  /** In-memory cache for fast routing lookups. */
  private cache = new Map<string, ProviderGroup>();

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    this.refreshCache();
  }

  /** Create the provider_groups table if it doesn't exist. */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_groups (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        model_pattern TEXT,
        members_json  TEXT NOT NULL,
        strategy      TEXT NOT NULL DEFAULT 'round-robin',
        weights_json  TEXT,
        sticky_ttl    INTEGER,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** Reload all groups from SQLite into the in-memory cache. */
  private refreshCache(): void {
    const rows = this.db
      .prepare('SELECT * FROM provider_groups ORDER BY name')
      .all() as GroupRow[];

    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.id, this.rowToGroup(row));
    }
  }

  /** Convert a DB row to a ProviderGroup. */
  private rowToGroup(row: GroupRow): ProviderGroup {
    return {
      id: row.id,
      name: row.name,
      modelPattern: row.model_pattern ?? undefined,
      members: JSON.parse(row.members_json) as GroupMember[],
      strategy: row.strategy as BalancerStrategy,
      weights: row.weights_json
        ? (JSON.parse(row.weights_json) as Record<string, number>)
        : undefined,
      stickyTTL: row.sticky_ttl ?? undefined,
    };
  }

  /** Generate a URL-safe ID from the group name. */
  private generateId(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const existing = this.cache.has(slug);
    if (!existing) return slug;
    // Append a short suffix on collision
    return `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  // ── CRUD ───────────────────────────────────────────────────

  /** Create a new provider group. Returns the created group. */
  create(input: CreateGroupInput): ProviderGroup {
    const validated = CreateGroupSchema.parse(input);
    const id = this.generateId(validated.name);

    const group: ProviderGroup = {
      id,
      name: validated.name,
      modelPattern: validated.modelPattern,
      members: validated.members,
      strategy: validated.strategy,
      weights: validated.weights,
      stickyTTL: validated.stickyTTL,
    };

    this.db
      .prepare(
        `INSERT INTO provider_groups (id, name, model_pattern, members_json, strategy, weights_json, sticky_ttl)
         VALUES (@id, @name, @modelPattern, @membersJson, @strategy, @weightsJson, @stickyTtl)`,
      )
      .run({
        id: group.id,
        name: group.name,
        modelPattern: group.modelPattern ?? null,
        membersJson: JSON.stringify(group.members),
        strategy: group.strategy,
        weightsJson: group.weights ? JSON.stringify(group.weights) : null,
        stickyTtl: group.stickyTTL ?? null,
      });

    this.cache.set(id, group);
    return group;
  }

  /** Get a group by ID. Returns null if not found. */
  get(id: string): ProviderGroup | null {
    return this.cache.get(id) ?? null;
  }

  /** List all groups. */
  list(): ProviderGroup[] {
    return Array.from(this.cache.values());
  }

  /** Update a group by ID. Returns the updated group or null if not found. */
  update(id: string, input: UpdateGroupInput): ProviderGroup | null {
    const existing = this.cache.get(id);
    if (!existing) return null;

    const validated = UpdateGroupSchema.parse(input);

    const updated: ProviderGroup = {
      ...existing,
      name: validated.name ?? existing.name,
      modelPattern: validated.modelPattern !== undefined ? validated.modelPattern : existing.modelPattern,
      members: validated.members ?? existing.members,
      strategy: validated.strategy ?? existing.strategy,
      weights: validated.weights !== undefined ? validated.weights : existing.weights,
      stickyTTL: validated.stickyTTL !== undefined ? validated.stickyTTL : existing.stickyTTL,
    };

    this.db
      .prepare(
        `UPDATE provider_groups
         SET name = @name,
             model_pattern = @modelPattern,
             members_json = @membersJson,
             strategy = @strategy,
             weights_json = @weightsJson,
             sticky_ttl = @stickyTtl,
             updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        name: updated.name,
        modelPattern: updated.modelPattern ?? null,
        membersJson: JSON.stringify(updated.members),
        strategy: updated.strategy,
        weightsJson: updated.weights ? JSON.stringify(updated.weights) : null,
        stickyTtl: updated.stickyTTL ?? null,
      });

    this.cache.set(id, updated);
    return updated;
  }

  /** Delete a group by ID. Returns true if deleted, false if not found. */
  delete(id: string): boolean {
    if (!this.cache.has(id)) return false;

    this.db.prepare('DELETE FROM provider_groups WHERE id = ?').run(id);
    this.cache.delete(id);
    return true;
  }

  /**
   * Find the first group whose modelPattern matches the given model name.
   * Supports glob patterns (* and ?) via conversion to regex.
   */
  findByModel(model: string): ProviderGroup | null {
    for (const group of this.cache.values()) {
      if (!group.modelPattern) continue;
      if (globMatch(group.modelPattern, model)) return group;
    }
    return null;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}

// ── Glob Matching ──────────────────────────────────────────

/**
 * Simple glob matcher supporting * (any chars) and ? (single char).
 * Also supports comma-separated patterns: "gpt-*,claude-*".
 */
export function globMatch(pattern: string, value: string): boolean {
  const patterns = pattern.split(',').map((p) => p.trim());
  return patterns.some((p) => singleGlobMatch(p, value));
}

function singleGlobMatch(pattern: string, value: string): boolean {
  // Escape regex special chars except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
  return new RegExp(regexStr, 'i').test(value);
}
