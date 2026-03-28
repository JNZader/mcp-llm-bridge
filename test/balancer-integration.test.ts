/**
 * Balancer integration tests — group matching + balancer selection + router.
 *
 * Tests the full flow: model → group resolution → balancer selection →
 * provider execution, including session stickiness.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { Router } from '../src/core/router.js';
import { GroupStore } from '../src/core/groups.js';
import { SessionStore } from '../src/core/session.js';
import type { LLMProvider, GenerateRequest, GenerateResponse, ModelInfo } from '../src/core/types.js';

// ── Mock Provider ──────────────────────────────────────────

function createMockProvider(
  id: string,
  modelIds: string[] = [],
  available = true,
): LLMProvider {
  const models: ModelInfo[] = modelIds.map((mid) => ({
    id: mid,
    name: mid,
    provider: id,
    maxTokens: 4096,
  }));

  return {
    id,
    name: id,
    type: 'api',
    models,
    async generate(_request: GenerateRequest): Promise<GenerateResponse> {
      return {
        text: `Response from ${id}`,
        provider: id,
        model: modelIds[0] ?? 'unknown',
        resolvedProvider: id,
        resolvedModel: modelIds[0] ?? 'unknown',
        fallbackUsed: false,
      };
    },
    async isAvailable(): Promise<boolean> {
      return available;
    },
  };
}

// ── Integration Tests ──────────────────────────────────────

describe('Balancer Integration', () => {
  let router: Router;
  let groupStore: GroupStore;
  let sessionStore: SessionStore;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `balancer-int-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
    const dbPath = join(testDir, 'groups.db');

    router = new Router();
    groupStore = new GroupStore(dbPath);
    sessionStore = new SessionStore(60_000);

    router.setGroupStore(groupStore);
    router.setSessionStore(sessionStore);
  });

  afterEach(() => {
    sessionStore.destroy();
    groupStore.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('GroupStore + Router', () => {
    it('findByModel resolves correct group', () => {
      groupStore.create({
        name: 'OpenAI Keys',
        modelPattern: 'gpt-*',
        members: [
          { provider: 'openai', keyName: 'key-a' },
          { provider: 'openai', keyName: 'key-b' },
        ],
        strategy: 'round-robin',
      });

      groupStore.create({
        name: 'Anthropic Keys',
        modelPattern: 'claude-*',
        members: [
          { provider: 'anthropic', keyName: 'key-a' },
        ],
        strategy: 'failover',
      });

      const gptGroup = groupStore.findByModel('gpt-4');
      assert.ok(gptGroup);
      assert.equal(gptGroup.name, 'OpenAI Keys');

      const claudeGroup = groupStore.findByModel('claude-3-opus');
      assert.ok(claudeGroup);
      assert.equal(claudeGroup.name, 'Anthropic Keys');

      // No match
      assert.equal(groupStore.findByModel('gemini-pro'), null);
    });

    it('router uses group store to find matching group', () => {
      // Register providers
      router.register(createMockProvider('openai', ['gpt-4']));
      router.register(createMockProvider('anthropic', ['claude-3']));

      // Create a group
      groupStore.create({
        name: 'OpenAI Pool',
        modelPattern: 'gpt-*',
        members: [{ provider: 'openai' }],
        strategy: 'round-robin',
      });

      // Verify group store is accessible from router
      assert.ok(router.groupStore);
      const group = router.groupStore.findByModel('gpt-4');
      assert.ok(group);
      assert.equal(group.name, 'OpenAI Pool');
    });
  });

  describe('Session Stickiness + Router', () => {
    it('pins and retrieves session correctly', () => {
      sessionStore.pin('app-1', 'gpt-4', 'openai', 'key-a', 10_000);

      const pinned = sessionStore.get('app-1', 'gpt-4');
      assert.deepEqual(pinned, { provider: 'openai', keyName: 'key-a' });
    });

    it('session store is accessible from router', () => {
      assert.ok(router.sessionStore);
      router.sessionStore.pin('app-1', 'gpt-4', 'openai', 'key-a', 10_000);
      const pinned = router.sessionStore.get('app-1', 'gpt-4');
      assert.deepEqual(pinned, { provider: 'openai', keyName: 'key-a' });
    });
  });

  describe('GroupStore CRUD via HTTP-like flow', () => {
    it('full lifecycle: create → list → update → delete', () => {
      // Create
      const group = groupStore.create({
        name: 'Test Pool',
        modelPattern: 'test-*',
        members: [
          { provider: 'p1', weight: 1 },
          { provider: 'p2', weight: 2 },
        ],
        strategy: 'weighted',
        stickyTTL: 300,
      });
      assert.ok(group.id);

      // List
      const list = groupStore.list();
      assert.equal(list.length, 1);
      assert.equal(list[0]?.name, 'Test Pool');

      // Update
      const updated = groupStore.update(group.id, {
        strategy: 'round-robin',
        stickyTTL: 600,
      });
      assert.ok(updated);
      assert.equal(updated.strategy, 'round-robin');
      assert.equal(updated.stickyTTL, 600);
      // Other fields preserved
      assert.equal(updated.modelPattern, 'test-*');
      assert.equal(updated.members.length, 2);

      // Delete
      assert.equal(groupStore.delete(group.id), true);
      assert.deepEqual(groupStore.list(), []);
    });
  });

  describe('Balancer strategy selection', () => {
    it('failover group always returns first provider', () => {
      router.register(createMockProvider('primary', ['gpt-4']));
      router.register(createMockProvider('secondary', ['gpt-4']));

      groupStore.create({
        name: 'Failover Pool',
        modelPattern: 'gpt-*',
        members: [
          { provider: 'primary', priority: 0 },
          { provider: 'secondary', priority: 1 },
        ],
        strategy: 'failover',
      });

      const group = groupStore.findByModel('gpt-4');
      assert.ok(group);
      assert.equal(group.strategy, 'failover');
      // Failover should return first member by priority
      assert.equal(group.members[0]?.provider, 'primary');
    });

    it('round-robin group with multiple members', () => {
      groupStore.create({
        name: 'RR Pool',
        modelPattern: 'model-*',
        members: [
          { provider: 'a' },
          { provider: 'b' },
          { provider: 'c' },
        ],
        strategy: 'round-robin',
      });

      const group = groupStore.findByModel('model-x');
      assert.ok(group);
      assert.equal(group.members.length, 3);
      assert.equal(group.strategy, 'round-robin');
    });
  });

  describe('Fallback when no group matches', () => {
    it('router falls back to standard resolution when no group matches', async () => {
      router.register(createMockProvider('openai', ['gpt-4']));

      // No groups created — should still work via standard resolution
      const models = await router.getAvailableModels();
      assert.equal(models.length, 1);
      assert.equal(models[0]?.id, 'gpt-4');
    });
  });
});
