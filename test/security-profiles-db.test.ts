/**
 * Security Profiles DB Tests — per-project profiles stored in SQLite.
 *
 * Covers:
 * - DB profile resolver: returns project profile, falls back to static
 * - Admin CRUD operations: POST, GET, DELETE /v1/admin/profiles
 * - ProfileEnforcer with resolver function
 */

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { Hono } from 'hono';

import { initializeDb } from '../src/vault/schema.js';
import {
  createDbProfileResolver,
  TOOL_CATEGORIES,
} from '../src/security/profiles.js';
import { ProfileEnforcer } from '../src/security/enforcer.js';
import { registerAdminRoutes, type AdminDeps } from '../src/server/admin.js';

// ── Helpers ─────────────────────────────────────────────────

/** Create an in-memory DB with all tables initialized. */
function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initializeDb(db);
  return db;
}

/** Insert a profile row directly into the DB. */
function insertProfile(
  db: Database.Database,
  project: string,
  trustLevel: string,
  categories: string[],
  rateLimitMax: number | null = null,
  rateLimitWindowMs: number | null = null,
): void {
  db.prepare(`
    INSERT INTO security_profiles (project, trust_level, allowed_categories, rate_limit_max, rate_limit_window_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(project, trustLevel, JSON.stringify(categories), rateLimitMax, rateLimitWindowMs);
}

/** Minimal tool definition. */
function toolDef(name: string) {
  return { name, description: `${name} tool`, inputSchema: { type: 'object' as const, properties: {} } };
}

// Track enforcers for cleanup
const enforcers: ProfileEnforcer[] = [];

// ── DB Profile Resolver ─────────────────────────────────────

describe('createDbProfileResolver', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  after(() => {
    for (const e of enforcers) e.destroy();
    enforcers.length = 0;
  });

  it('returns project-specific profile from DB', () => {
    insertProfile(db, 'frontend-app', 'restricted', ['read', 'generate'], 50, 60_000);
    const resolver = createDbProfileResolver(db);

    const profile = resolver('frontend-app');
    assert.ok(profile, 'Expected a profile to be returned');
    assert.equal(profile.level, 'restricted');
    assert.deepEqual([...profile.allowedCategories].sort(), ['generate', 'read']);
    assert.deepEqual(profile.rateLimit, { max: 50, windowMs: 60_000 });
  });

  it('returns null when no DB entry exists (fallback to static)', () => {
    const resolver = createDbProfileResolver(db);
    const profile = resolver('nonexistent-project');
    assert.equal(profile, null);
  });

  it('falls back to static profile when stored categories are invalid', () => {
    // Insert with invalid categories
    db.prepare(`
      INSERT INTO security_profiles (project, trust_level, allowed_categories)
      VALUES (?, ?, ?)
    `).run('bad-project', 'restricted', JSON.stringify(['invalid_cat']));

    const resolver = createDbProfileResolver(db);
    const profile = resolver('bad-project');
    assert.ok(profile, 'Expected fallback profile');
    // Should match the static 'restricted' profile
    assert.equal(profile.level, 'restricted');
    assert.deepEqual([...profile.allowedCategories].sort(), ['generate', 'read']);
  });

  it('handles null rate limits correctly', () => {
    insertProfile(db, 'no-limit-project', 'local-dev', ['destructive', 'read', 'generate', 'admin']);
    const resolver = createDbProfileResolver(db);

    const profile = resolver('no-limit-project');
    assert.ok(profile);
    assert.equal(profile.rateLimit, null);
  });

  it('validates trust level and defaults to restricted for unknown', () => {
    db.prepare(`
      INSERT INTO security_profiles (project, trust_level, allowed_categories)
      VALUES (?, ?, ?)
    `).run('weird-project', 'unknown-level', JSON.stringify(['read']));

    const resolver = createDbProfileResolver(db);
    const profile = resolver('weird-project');
    assert.ok(profile);
    assert.equal(profile.level, 'restricted');
  });
});

// ── ProfileEnforcer with Resolver ───────────────────────────

describe('ProfileEnforcer with ProfileResolver', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  after(() => {
    for (const e of enforcers) e.destroy();
    enforcers.length = 0;
  });

  it('resolves project-specific profile via resolveForProject()', () => {
    insertProfile(db, 'frontend-app', 'restricted', ['read', 'generate']);
    const resolver = createDbProfileResolver(db);
    const enforcer = new ProfileEnforcer(resolver);
    enforcers.push(enforcer);

    const profile = enforcer.resolveForProject('frontend-app');
    assert.equal(profile.level, 'restricted');
    assert.deepEqual([...profile.allowedCategories].sort(), ['generate', 'read']);
  });

  it('falls back to default profile when resolver returns null', () => {
    const resolver = createDbProfileResolver(db);
    const enforcer = new ProfileEnforcer(resolver);
    enforcers.push(enforcer);

    const profile = enforcer.resolveForProject('unknown-project');
    // Default is 'restricted' when using resolver mode
    assert.equal(profile.level, 'restricted');
  });

  it('backward compatible: still accepts string profile name', () => {
    const enforcer = new ProfileEnforcer('local-dev');
    enforcers.push(enforcer);
    assert.equal(enforcer.profile.level, 'local-dev');
  });

  it('backward compatible: throws on unknown string profile', () => {
    assert.throws(
      () => new ProfileEnforcer('nonexistent'),
      /Unknown security profile/,
    );
  });

  it('filterTools uses resolved profile categories', () => {
    insertProfile(db, 'read-only-app', 'restricted', ['read']);
    const resolver = createDbProfileResolver(db);
    const enforcer = new ProfileEnforcer(resolver);
    enforcers.push(enforcer);

    const profile = enforcer.resolveForProject('read-only-app');
    const allowedCategories = new Set(profile.allowedCategories);

    // Manually filter tools based on the resolved profile
    const tools = [
      toolDef('vault_list'),     // read
      toolDef('llm_generate'),   // generate
      toolDef('vault_store'),    // destructive
    ];

    const filtered = tools.filter((t) => {
      const cat = TOOL_CATEGORIES[t.name];
      return cat && allowedCategories.has(cat);
    });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.name, 'vault_list');
  });
});

// ── Admin CRUD Routes ───────────────────────────────────────

describe('Admin Profile CRUD Routes', () => {
  let db: Database.Database;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    app = new Hono();

    // Minimal deps — we only need db for profile routes
    const deps: AdminDeps = {
      router: {} as AdminDeps['router'],
      vault: {} as AdminDeps['vault'],
      config: { masterKey: Buffer.alloc(32), dbPath: ':memory:', httpPort: 0 },
      serverStartTime: Date.now(),
      db,
    };

    registerAdminRoutes(app, deps);
  });

  it('POST /v1/admin/profiles creates a new profile', async () => {
    const res = await app.request('/v1/admin/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'my-frontend',
        trustLevel: 'restricted',
        allowedCategories: ['read', 'generate'],
        rateLimitMax: 200,
        rateLimitWindowMs: 60_000,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.project, 'my-frontend');
    assert.deepEqual(body.allowedCategories, ['read', 'generate']);
  });

  it('POST /v1/admin/profiles upserts on conflict', async () => {
    // Create initial
    await app.request('/v1/admin/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'my-frontend',
        allowedCategories: ['read'],
      }),
    });

    // Update
    const res = await app.request('/v1/admin/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'my-frontend',
        allowedCategories: ['read', 'generate', 'admin'],
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.deepEqual(body.allowedCategories, ['read', 'generate', 'admin']);

    // Verify only one row in DB
    const count = db.prepare('SELECT COUNT(*) as cnt FROM security_profiles WHERE project = ?').get('my-frontend') as { cnt: number };
    assert.equal(count.cnt, 1);
  });

  it('POST /v1/admin/profiles rejects invalid payload', async () => {
    const res = await app.request('/v1/admin/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: '',
        allowedCategories: [],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('POST /v1/admin/profiles rejects unknown categories', async () => {
    const res = await app.request('/v1/admin/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'test',
        allowedCategories: ['nuclear'],
      }),
    });

    assert.equal(res.status, 400);
  });

  it('GET /v1/admin/profiles lists all profiles', async () => {
    // Insert two profiles
    insertProfile(db, 'alpha', 'restricted', ['read', 'generate']);
    insertProfile(db, 'beta', 'open', ['generate']);

    const res = await app.request('/v1/admin/profiles');
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.profiles.length, 2);
    assert.equal(body.profiles[0].project, 'alpha');
    assert.equal(body.profiles[1].project, 'beta');
    assert.deepEqual(body.profiles[0].allowedCategories, ['read', 'generate']);
  });

  it('GET /v1/admin/profiles returns empty array when no profiles', async () => {
    const res = await app.request('/v1/admin/profiles');
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.deepEqual(body.profiles, []);
  });

  it('DELETE /v1/admin/profiles/:project removes profile', async () => {
    insertProfile(db, 'to-delete', 'restricted', ['read']);

    const res = await app.request('/v1/admin/profiles/to-delete', {
      method: 'DELETE',
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Verify deleted
    const row = db.prepare('SELECT * FROM security_profiles WHERE project = ?').get('to-delete');
    assert.equal(row, undefined);
  });

  it('DELETE /v1/admin/profiles/:project returns 404 for nonexistent', async () => {
    const res = await app.request('/v1/admin/profiles/ghost-project', {
      method: 'DELETE',
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error.includes('No profile found'));
  });

  it('profile is immediately active after creation', async () => {
    // Create profile via API
    await app.request('/v1/admin/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: 'live-project',
        trustLevel: 'restricted',
        allowedCategories: ['read', 'generate'],
        rateLimitMax: 100,
        rateLimitWindowMs: 300_000,
      }),
    });

    // Verify resolver can find it immediately
    const resolver = createDbProfileResolver(db);
    const profile = resolver('live-project');
    assert.ok(profile, 'Profile should be immediately resolvable');
    assert.equal(profile.level, 'restricted');
    assert.deepEqual([...profile.allowedCategories].sort(), ['generate', 'read']);
    assert.deepEqual(profile.rateLimit, { max: 100, windowMs: 300_000 });
  });
});
