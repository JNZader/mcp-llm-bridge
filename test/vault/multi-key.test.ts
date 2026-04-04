/**
 * Tests for MultiKeyManager
 *
 * TDD approach: Tests cover key scenarios including:
 * - Adding multiple keys for same provider
 * - Priority-based key selection (lower = higher priority)
 * - Cooldown management and expiration
 * - Auto-rotation on rate limits
 * - Request count tracking
 * - Error handling and backoff escalation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

import { MultiKeyManager } from '../../src/vault/multi-key-manager.js';
import { Vault } from '../../src/vault/vault.js';
import { initializeDb } from '../../src/vault/schema.js';
import { decrypt } from '../../src/vault/crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_DIR = join(__dirname, '..', '.test-db');
const TEST_DB_PATH = join(TEST_DB_DIR, 'multi-key-test.db');

// Test master key (32 bytes for AES-256)
const TEST_MASTER_KEY = Buffer.from('a'.repeat(32));

describe('MultiKeyManager', () => {
  let db: Database.Database;
  let vault: Vault;
  let manager: MultiKeyManager;

  // Helper to create a mock GatewayConfig
  const createConfig = () => ({
    masterKey: TEST_MASTER_KEY,
    dbPath: TEST_DB_PATH,
    httpPort: 0,
  });

  // Helper to decrypt using crypto module
  const decryptFn = (encrypted: Buffer, iv: Buffer, authTag: Buffer): string => {
    return decrypt(
      { encrypted, iv, authTag },
      TEST_MASTER_KEY
    );
  };

  beforeEach(() => {
    // Ensure test directory exists
    mkdirSync(TEST_DB_DIR, { recursive: true });

    // Clean up any existing test database
    try {
      rmSync(TEST_DB_PATH);
    } catch {
      // File may not exist
    }

    // Create fresh database with schema
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeDb(db);

    // Apply migration 003 manually for testing
    db.exec(`
      ALTER TABLE credentials ADD COLUMN key_priority INTEGER DEFAULT 0;
      ALTER TABLE credentials ADD COLUMN cooldown_until INTEGER;
      ALTER TABLE credentials ADD COLUMN last_used_at INTEGER;
      ALTER TABLE credentials ADD COLUMN request_count INTEGER DEFAULT 0;
      ALTER TABLE credentials ADD COLUMN error_count INTEGER DEFAULT 0;
      ALTER TABLE credentials ADD COLUMN consecutive_errors INTEGER DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_credentials_cooldown ON credentials(provider, cooldown_until);
      CREATE INDEX IF NOT EXISTS idx_credentials_priority ON credentials(provider, key_priority);
    `);

    // Create vault and manager
    vault = new Vault(createConfig());
    manager = new MultiKeyManager(db);
  });

  afterEach(() => {
    vault.close();
    db.close();

    // Clean up test database
    try {
      rmSync(TEST_DB_PATH);
    } catch {
      // File may not exist
    }
  });

  describe('addKey', () => {
    it('should set priority for a stored credential', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-abc123', 'test-project');
      const result = await manager.addKey(keyId, 1);

      assert.strictEqual(result, true);

      const stats = await manager.getKeyStatus(keyId, decryptFn);
      assert.strictEqual(stats?.priority, 1);
    });

    it('should return false for non-existent key', async () => {
      const result = await manager.addKey(99999, 1);
      assert.strictEqual(result, false);
    });
  });

  describe('getKey', () => {
    it('should return key with highest priority (lowest number)', async () => {
      // Store two keys with different priorities
      const keyId1 = vault.store('openai', 'key1', 'sk-priority1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-priority2', 'test-project');

      await manager.addKey(keyId1, 1); // Higher priority (lower number)
      await manager.addKey(keyId2, 2); // Lower priority

      const key = await manager.getKey(
        { provider: 'openai', project: 'test-project' },
        decryptFn
      );

      assert.ok(key);
      assert.strictEqual(key?.key, 'sk-priority1');
      assert.strictEqual(key?.priority, 1);
    });

    it('should skip keys in cooldown', async () => {
      // Store two keys
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 2);

      // Put key1 on cooldown
      await manager.putOnCooldown(keyId1, 60000); // 1 minute cooldown

      // Should return key2
      const key = await manager.getKey(
        { provider: 'openai', project: 'test-project' },
        decryptFn
      );

      assert.ok(key);
      assert.strictEqual(key?.key, 'sk-key2');
      assert.strictEqual(key?.id, keyId2);
    });

    it('should return soonest available when all keys in cooldown', async () => {
      // Store two keys
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 2);

      // Put both on cooldown - key2 with shorter cooldown
      await manager.putOnCooldown(keyId1, 300000); // 5 minutes
      await manager.putOnCooldown(keyId2, 60000); // 1 minute

      const key = await manager.getKey(
        { provider: 'openai', project: 'test-project' },
        decryptFn
      );

      // Should return key2 (shorter cooldown)
      assert.ok(key);
      assert.strictEqual(key?.id, keyId2);
      assert.strictEqual(key?.isAvailable, false); // Still in cooldown
    });

    it('should return null when no keys exist', async () => {
      const key = await manager.getKey(
        { provider: 'nonexistent', project: 'test-project' },
        decryptFn
      );

      assert.strictEqual(key, null);
    });

    it('should respect project scoping', async () => {
      // Store keys for different projects
      const keyId1 = vault.store('openai', 'key1', 'sk-project1', 'project1');
      const keyId2 = vault.store('openai', 'key2', 'sk-project2', 'project2');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 1);

      const key = await manager.getKey(
        { provider: 'openai', project: 'project1' },
        decryptFn
      );

      assert.ok(key);
      assert.strictEqual(key?.key, 'sk-project1');
      assert.strictEqual(key?.project, 'project1');
    });

    it('should fall back to _global keys when project has no keys', async () => {
      // Store global key
      const keyId = vault.store('openai', 'key1', 'sk-global', '_global');
      await manager.addKey(keyId, 1);

      // Request from project that has no keys
      const key = await manager.getKey(
        { provider: 'openai', project: 'new-project' },
        decryptFn
      );

      assert.ok(key);
      assert.strictEqual(key?.key, 'sk-global');
    });
  });

  describe('markUsed', () => {
    it('should increment request_count', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      await manager.markUsed(keyId);
      await manager.markUsed(keyId);
      await manager.markUsed(keyId);

      const status = await manager.getKeyStatus(keyId);
      assert.strictEqual(status?.requestCount, 3);
    });

    it('should update last_used_at timestamp', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      const before = Date.now();
      await manager.markUsed(keyId);
      const after = Date.now();

      const status = await manager.getKeyStatus(keyId);
      assert.ok(status?.lastUsedAt);
      assert.ok(status!.lastUsedAt! >= before);
      assert.ok(status!.lastUsedAt! <= after);
    });
  });

  describe('putOnCooldown', () => {
    it('should set cooldown_until timestamp', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      const before = Date.now();
      await manager.putOnCooldown(keyId, 60000); // 1 minute
      const after = Date.now();

      const status = await manager.getKeyStatus(keyId);
      assert.ok(status?.cooldownUntil);
      assert.ok(status!.cooldownUntil! >= before + 60000);
      assert.ok(status!.cooldownUntil! <= after + 60000);
    });

    it('should increment error_count', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      await manager.putOnCooldown(keyId);
      await manager.putOnCooldown(keyId);

      const status = await manager.getKeyStatus(keyId);
      assert.strictEqual(status?.errorCount, 2);
      assert.strictEqual(status?.consecutiveErrors, 2);
    });

    it('should use default cooldown when duration not specified', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      const before = Date.now();
      await manager.putOnCooldown(keyId); // Uses default 5 minutes
      const after = Date.now();

      const status = await manager.getKeyStatus(keyId);
      const expectedMin = before + 5 * 60 * 1000;
      const expectedMax = after + 5 * 60 * 1000;

      assert.ok(status?.cooldownUntil! >= expectedMin);
      assert.ok(status?.cooldownUntil! <= expectedMax);
    });

    it('should escalate cooldown duration for repeated failures', async () => {
      // Create manager with lower threshold for testing
      const testManager = new MultiKeyManager(db, {
        defaultCooldownMs: 1000, // 1 second base
        maxConsecutiveErrors: 2,
        cooldownMultiplier: 3,
      });

      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await testManager.addKey(keyId, 1);

      // First cooldown - normal duration
      await testManager.putOnCooldown(keyId);
      const status1 = await testManager.getKeyStatus(keyId);
      void (status1!.cooldownUntil! - Date.now());

      // Second cooldown - normal (consecutiveErrors = 1, below threshold)
      await testManager.putOnCooldown(keyId);
      const status2 = await testManager.getKeyStatus(keyId);
      const duration2 = status2!.cooldownUntil! - Date.now();

      // Third cooldown - escalated (consecutiveErrors >= 2)
      await testManager.putOnCooldown(keyId);
      const status3 = await testManager.getKeyStatus(keyId);
      const duration3 = status3!.cooldownUntil! - Date.now();

      // Third duration should be multiplied (3x)
      assert.ok(duration3 > duration2 * 2, 'Cooldown should escalate after threshold');
    });
  });

  describe('markSuccess', () => {
    it('should reset consecutive_errors', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      // Add some errors first
      await manager.recordError(keyId);
      await manager.recordError(keyId);

      let status = await manager.getKeyStatus(keyId);
      assert.strictEqual(status?.consecutiveErrors, 2);

      // Mark success
      await manager.markSuccess(keyId);

      status = await manager.getKeyStatus(keyId);
      assert.strictEqual(status?.consecutiveErrors, 0);
      // error_count should remain
      assert.strictEqual(status?.errorCount, 2);
    });
  });

  describe('recordError', () => {
    it('should increment error_count and consecutive_errors', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      await manager.recordError(keyId);
      await manager.recordError(keyId);

      const status = await manager.getKeyStatus(keyId);
      assert.strictEqual(status?.errorCount, 2);
      assert.strictEqual(status?.consecutiveErrors, 2);
    });

    it('should not put key on cooldown', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      await manager.recordError(keyId);

      const status = await manager.getKeyStatus(keyId);
      assert.strictEqual(status?.cooldownUntil, null);
      assert.strictEqual(status?.isAvailable, true);
    });
  });

  describe('getAllKeys', () => {
    it('should return all keys for provider', async () => {
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');
      const keyId3 = vault.store('anthropic', 'key1', 'sk-anthropic', 'test-project');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 2);
      await manager.addKey(keyId3, 1);

      const keys = await manager.getAllKeys('openai', 'test-project', decryptFn);

      assert.strictEqual(keys.length, 2);
      assert.ok(keys.some((k) => k.key === 'sk-key1'));
      assert.ok(keys.some((k) => k.key === 'sk-key2'));
    });

    it('should sort keys by priority', async () => {
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');
      const keyId3 = vault.store('openai', 'key3', 'sk-key3', 'test-project');

      await manager.addKey(keyId1, 3);
      await manager.addKey(keyId2, 1); // Highest priority
      await manager.addKey(keyId3, 2);

      const keys = await manager.getAllKeys('openai', 'test-project', decryptFn);

      assert.strictEqual(keys[0]!.priority, 1);
      assert.strictEqual(keys[1]!.priority, 2);
      assert.strictEqual(keys[2]!.priority, 3);
    });
  });

  describe('rotateKey', () => {
    it('should return different key than current', async () => {
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 1);

      const nextKey = await manager.rotateKey(
        keyId1,
        { provider: 'openai', project: 'test-project' },
        decryptFn
      );

      assert.ok(nextKey);
      assert.notStrictEqual(nextKey?.id, keyId1);
      assert.strictEqual(nextKey?.id, keyId2);
    });

    it('should mark current key as used for LRU', async () => {
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 1);

      await manager.rotateKey(keyId1, { provider: 'openai', project: 'test-project' }, decryptFn);

      const status1 = await manager.getKeyStatus(keyId1);
      assert.ok(status1?.lastUsedAt);
      assert.strictEqual(status1?.requestCount, 1);
    });

    it('should skip keys in cooldown when rotating', async () => {
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');
      const keyId3 = vault.store('openai', 'key3', 'sk-key3', 'test-project');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 1);
      await manager.addKey(keyId3, 1);

      // Put key2 on cooldown
      await manager.putOnCooldown(keyId2);

      // Rotate from key1 - should skip key2 and go to key3
      const nextKey = await manager.rotateKey(
        keyId1,
        { provider: 'openai', project: 'test-project' },
        decryptFn
      );

      assert.strictEqual(nextKey?.id, keyId3);
    });

    it('should return null when no other keys available', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      await manager.addKey(keyId, 1);

      const nextKey = await manager.rotateKey(
        keyId,
        { provider: 'openai', project: 'test-project' },
        decryptFn
      );

      // Should return the same key (even if on cooldown)
      assert.ok(nextKey);
      assert.strictEqual(nextKey?.id, keyId);
    });
  });

  describe('getKeyStatistics', () => {
    it('should calculate success rate correctly', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      // 3 successes, 1 error = 75% success rate
      await manager.markUsed(keyId);
      await manager.markUsed(keyId);
      await manager.markUsed(keyId);
      await manager.recordError(keyId);

      const stats = await manager.getKeyStatistics(keyId);
      assert.strictEqual(stats?.successRate, 75);
    });

    it('should return 100% success rate with no errors', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      await manager.markUsed(keyId);

      const stats = await manager.getKeyStatistics(keyId);
      assert.strictEqual(stats?.successRate, 100);
    });

    it('should calculate average cooldown with consecutive errors', async () => {
      const testManager = new MultiKeyManager(db, {
        defaultCooldownMs: 60000,
        cooldownMultiplier: 2,
      });

      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await testManager.addKey(keyId, 1);

      // 3 consecutive errors = escalated cooldown
      await testManager.putOnCooldown(keyId);
      await testManager.putOnCooldown(keyId);
      await testManager.putOnCooldown(keyId);

      const stats = await testManager.getKeyStatistics(keyId);
      // With 3 errors (>= maxConsecutiveErrors which defaults to 3),
      // averageCooldownMs should be default * multiplier
      assert.ok(stats!.averageCooldownMs >= 60000);
    });
  });

  describe('clearCooldown', () => {
    it('should remove cooldown and reset consecutive errors', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      await manager.putOnCooldown(keyId);

      let status = await manager.getKeyStatus(keyId);
      assert.ok(status?.cooldownUntil);
      assert.strictEqual(status?.consecutiveErrors, 1);

      await manager.clearCooldown(keyId);

      status = await manager.getKeyStatus(keyId);
      assert.strictEqual(status?.cooldownUntil, null);
      assert.strictEqual(status?.consecutiveErrors, 0);
      assert.strictEqual(status?.isAvailable, true);
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', async () => {
      const keyId = vault.store('openai', 'key1', 'sk-test', 'test-project');
      await manager.addKey(keyId, 1);

      await manager.markUsed(keyId);
      await manager.recordError(keyId);
      await manager.putOnCooldown(keyId);

      await manager.resetStats(keyId);

      const status = await manager.getKeyStatus(keyId);
      assert.strictEqual(status?.requestCount, 0);
      assert.strictEqual(status?.errorCount, 0);
      assert.strictEqual(status?.consecutiveErrors, 0);
      assert.strictEqual(status?.cooldownUntil, null);
      assert.strictEqual(status?.lastUsedAt, null);
    });
  });

  describe('getProviderSummary', () => {
    it('should return summary of all keys', async () => {
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');
      const keyId3 = vault.store('openai', 'key3', 'sk-key3', 'test-project');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 1);
      await manager.addKey(keyId3, 1);

      // Use keys and put one on cooldown
      await manager.markUsed(keyId1);
      await manager.markUsed(keyId1);
      await manager.markUsed(keyId2);
      await manager.putOnCooldown(keyId3);

      const summary = await manager.getProviderSummary('openai', 'test-project');

      assert.strictEqual(summary.totalKeys, 3);
      assert.strictEqual(summary.availableKeys, 2);
      assert.strictEqual(summary.keysInCooldown, 1);
      assert.strictEqual(summary.totalRequests, 3);
      assert.strictEqual(summary.totalErrors, 1); // putOnCooldown increments error_count
    });
  });

  describe('Integration: 429 auto-rotation simulation', () => {
    it('should handle 429 by rotating to next key', async () => {
      const keyId1 = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      const keyId2 = vault.store('openai', 'key2', 'sk-key2', 'test-project');

      await manager.addKey(keyId1, 1);
      await manager.addKey(keyId2, 2);

      // Simulate request with key1
      const key = await manager.getKey(
        { provider: 'openai', project: 'test-project' },
        decryptFn
      );
      assert.strictEqual(key?.id, keyId1);

      // Mark as used
      await manager.markUsed(key!.id);

      // Simulate 429 error - put key1 on cooldown
      await manager.putOnCooldown(key!.id);

      // Next request should get key2
      const nextKey = await manager.getKey(
        { provider: 'openai', project: 'test-project' },
        decryptFn
      );

      assert.strictEqual(nextKey?.id, keyId2);
      assert.strictEqual(nextKey?.isAvailable, true);
    });

    it('should escalate cooldown for repeatedly failing keys', async () => {
      const testManager = new MultiKeyManager(db, {
        defaultCooldownMs: 100, // Very short for testing
        maxConsecutiveErrors: 1,
        cooldownMultiplier: 2,
      });

      const keyId = vault.store('openai', 'key1', 'sk-key1', 'test-project');
      await testManager.addKey(keyId, 1);

      // First cooldown
      await testManager.putOnCooldown(keyId);
      const status1 = await testManager.getKeyStatus(keyId);
      const cooldown1 = status1!.cooldownUntil! - Date.now();

      // Wait a bit then second cooldown (should escalate)
      await new Promise((resolve) => setTimeout(resolve, 10));
      await testManager.putOnCooldown(keyId);
      const status2 = await testManager.getKeyStatus(keyId);
      const cooldown2 = status2!.cooldownUntil! - Date.now();

      // Second cooldown should be longer
      assert.ok(cooldown2 > cooldown1);
    });
  });
});
