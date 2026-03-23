/**
 * GroupStore CRUD tests — create, get, list, update, delete, model matching.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { GroupStore, globMatch } from '../src/core/groups.js';
import type { CreateGroupInput } from '../src/core/groups.js';

// ── Test Helpers ───────────────────────────────────────────

function createTestDb(): { store: GroupStore; dbPath: string } {
  const dir = join(tmpdir(), `groups-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'test.db');
  const store = new GroupStore(dbPath);
  return { store, dbPath: dir };
}

// ── globMatch ──────────────────────────────────────────────

describe('globMatch', () => {
  it('matches exact string', () => {
    assert.ok(globMatch('gpt-4', 'gpt-4'));
  });

  it('matches wildcard *', () => {
    assert.ok(globMatch('gpt-*', 'gpt-4'));
    assert.ok(globMatch('gpt-*', 'gpt-4o-mini'));
    assert.ok(!globMatch('gpt-*', 'claude-3'));
  });

  it('matches single char ?', () => {
    assert.ok(globMatch('gpt-?', 'gpt-4'));
    assert.ok(!globMatch('gpt-?', 'gpt-4o'));
  });

  it('matches comma-separated patterns', () => {
    assert.ok(globMatch('gpt-*, claude-*', 'gpt-4'));
    assert.ok(globMatch('gpt-*, claude-*', 'claude-3'));
    assert.ok(!globMatch('gpt-*, claude-*', 'gemini-pro'));
  });

  it('is case-insensitive', () => {
    assert.ok(globMatch('GPT-*', 'gpt-4'));
    assert.ok(globMatch('gpt-*', 'GPT-4'));
  });
});

// ── GroupStore CRUD ────────────────────────────────────────

describe('GroupStore', () => {
  let store: GroupStore;
  let testDir: string;

  const INPUT: CreateGroupInput = {
    name: 'Test Group',
    modelPattern: 'gpt-*',
    members: [
      { provider: 'openai', keyName: 'key-a', weight: 1, priority: 0 },
      { provider: 'openai', keyName: 'key-b', weight: 2, priority: 1 },
    ],
    strategy: 'round-robin',
    stickyTTL: 3600,
  };

  beforeEach(() => {
    const result = createTestDb();
    store = result.store;
    testDir = result.dbPath;
  });

  afterEach(() => {
    store.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('create', () => {
    it('creates a group and returns it', () => {
      const group = store.create(INPUT);
      assert.ok(group.id);
      assert.equal(group.name, 'Test Group');
      assert.equal(group.modelPattern, 'gpt-*');
      assert.equal(group.strategy, 'round-robin');
      assert.equal(group.members.length, 2);
      assert.equal(group.stickyTTL, 3600);
    });

    it('generates URL-safe ID from name', () => {
      const group = store.create({ ...INPUT, name: 'My Cool Group 2024!' });
      assert.ok(/^[a-z0-9-]+$/.test(group.id), `ID should be URL-safe: ${group.id}`);
    });

    it('validates input with Zod', () => {
      assert.throws(() => {
        store.create({ ...INPUT, name: '' });
      });
    });

    it('rejects empty members array', () => {
      assert.throws(() => {
        store.create({ ...INPUT, members: [] });
      });
    });
  });

  describe('get', () => {
    it('returns group by ID', () => {
      const created = store.create(INPUT);
      const found = store.get(created.id);
      assert.deepEqual(found, created);
    });

    it('returns null for unknown ID', () => {
      assert.equal(store.get('nonexistent'), null);
    });
  });

  describe('list', () => {
    it('returns empty array when no groups', () => {
      assert.deepEqual(store.list(), []);
    });

    it('returns all groups', () => {
      store.create(INPUT);
      store.create({ ...INPUT, name: 'Another Group', modelPattern: 'claude-*' });
      const list = store.list();
      assert.equal(list.length, 2);
    });
  });

  describe('update', () => {
    it('updates group fields', () => {
      const created = store.create(INPUT);
      const updated = store.update(created.id, {
        name: 'Updated Name',
        strategy: 'weighted',
      });
      assert.ok(updated);
      assert.equal(updated.name, 'Updated Name');
      assert.equal(updated.strategy, 'weighted');
      // Unchanged fields preserved
      assert.equal(updated.modelPattern, 'gpt-*');
      assert.equal(updated.members.length, 2);
    });

    it('returns null for unknown ID', () => {
      assert.equal(store.update('nonexistent', { name: 'x' }), null);
    });
  });

  describe('delete', () => {
    it('deletes existing group', () => {
      const created = store.create(INPUT);
      assert.equal(store.delete(created.id), true);
      assert.equal(store.get(created.id), null);
    });

    it('returns false for unknown ID', () => {
      assert.equal(store.delete('nonexistent'), false);
    });
  });

  describe('findByModel', () => {
    it('finds group matching model pattern', () => {
      store.create(INPUT); // gpt-*
      store.create({ ...INPUT, name: 'Claude', modelPattern: 'claude-*' });

      const found = store.findByModel('gpt-4');
      assert.ok(found);
      assert.equal(found.modelPattern, 'gpt-*');
    });

    it('returns null when no pattern matches', () => {
      store.create(INPUT); // gpt-*
      assert.equal(store.findByModel('gemini-pro'), null);
    });

    it('skips groups without modelPattern', () => {
      store.create({ ...INPUT, modelPattern: undefined });
      assert.equal(store.findByModel('gpt-4'), null);
    });
  });

  describe('persistence', () => {
    it('survives close and reopen', () => {
      const created = store.create(INPUT);
      const dbPath = join(testDir, 'test.db');
      store.close();

      // Reopen
      const store2 = new GroupStore(dbPath);
      const found = store2.get(created.id);
      assert.ok(found);
      assert.equal(found.name, 'Test Group');
      assert.equal(found.members.length, 2);
      store2.close();
    });
  });
});
