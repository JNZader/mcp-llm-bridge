/**
 * Migration Tests for analytics tables
 *
 * Tests cover:
 * - Table creation with correct columns
 * - Index creation
 * - Unique constraints
 * - Migration idempotency
 * - Rollback functionality
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MigrationRunner } from '../../src/db/migrate.js';

describe('Migration 002: analytics tables', () => {
  let runner: MigrationRunner;

  beforeEach(() => {
    // Use in-memory database for tests
    runner = new MigrationRunner({ dbPath: ':memory:' });
  });

  afterEach(() => {
    runner.close();
  });

  describe('Table creation', () => {
    it('should create analytics_hourly table with correct columns', async () => {
      await runner.runMigration(2);

      const columns = runner.getTableInfo('analytics_hourly');
      const columnMap = new Map(columns.map(c => [c.name, c.type]));

      assert.strictEqual(columnMap.get('hour'), 'INTEGER', 'hour should be INTEGER');
      assert.strictEqual(columnMap.get('requests'), 'INTEGER', 'requests should be INTEGER');
      assert.strictEqual(columnMap.get('input_tokens'), 'INTEGER', 'input_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('output_tokens'), 'INTEGER', 'output_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('cost'), 'REAL', 'cost should be REAL');
      assert.strictEqual(columnMap.get('avg_latency_ms'), 'INTEGER', 'avg_latency_ms should be INTEGER');
      assert.strictEqual(columnMap.get('p95_latency_ms'), 'INTEGER', 'p95_latency_ms should be INTEGER');
      assert.strictEqual(columnMap.get('p99_latency_ms'), 'INTEGER', 'p99_latency_ms should be INTEGER');
    });

    it('should create analytics_daily table with correct columns', async () => {
      await runner.runMigration(2);

      const columns = runner.getTableInfo('analytics_daily');
      const columnMap = new Map(columns.map(c => [c.name, c.type]));

      assert.strictEqual(columnMap.get('day'), 'INTEGER', 'day should be INTEGER');
      assert.strictEqual(columnMap.get('requests'), 'INTEGER', 'requests should be INTEGER');
      assert.strictEqual(columnMap.get('input_tokens'), 'INTEGER', 'input_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('output_tokens'), 'INTEGER', 'output_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('cost'), 'REAL', 'cost should be REAL');
      assert.strictEqual(columnMap.get('avg_latency_ms'), 'INTEGER', 'avg_latency_ms should be INTEGER');
      assert.strictEqual(columnMap.get('p95_latency_ms'), 'INTEGER', 'p95_latency_ms should be INTEGER');
      assert.strictEqual(columnMap.get('p99_latency_ms'), 'INTEGER', 'p99_latency_ms should be INTEGER');
    });

    it('should create analytics_channel table with correct columns', async () => {
      await runner.runMigration(2);

      const columns = runner.getTableInfo('analytics_channel');
      const columnMap = new Map(columns.map(c => [c.name, c.type]));

      assert.strictEqual(columnMap.get('id'), 'INTEGER', 'id should be INTEGER');
      assert.strictEqual(columnMap.get('channel_id'), 'TEXT', 'channel_id should be TEXT');
      assert.strictEqual(columnMap.get('timestamp'), 'INTEGER', 'timestamp should be INTEGER');
      assert.strictEqual(columnMap.get('requests'), 'INTEGER', 'requests should be INTEGER');
      assert.strictEqual(columnMap.get('input_tokens'), 'INTEGER', 'input_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('output_tokens'), 'INTEGER', 'output_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('cost'), 'REAL', 'cost should be REAL');
      assert.strictEqual(columnMap.get('avg_latency_ms'), 'INTEGER', 'avg_latency_ms should be INTEGER');
    });

    it('should create analytics_model table with correct columns', async () => {
      await runner.runMigration(2);

      const columns = runner.getTableInfo('analytics_model');
      const columnMap = new Map(columns.map(c => [c.name, c.type]));

      assert.strictEqual(columnMap.get('id'), 'INTEGER', 'id should be INTEGER');
      assert.strictEqual(columnMap.get('model'), 'TEXT', 'model should be TEXT');
      assert.strictEqual(columnMap.get('timestamp'), 'INTEGER', 'timestamp should be INTEGER');
      assert.strictEqual(columnMap.get('requests'), 'INTEGER', 'requests should be INTEGER');
      assert.strictEqual(columnMap.get('input_tokens'), 'INTEGER', 'input_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('output_tokens'), 'INTEGER', 'output_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('cost'), 'REAL', 'cost should be REAL');
      assert.strictEqual(columnMap.get('avg_latency_ms'), 'INTEGER', 'avg_latency_ms should be INTEGER');
    });
  });

  describe('Indexes', () => {
    it('should create all required indexes', async () => {
      await runner.runMigration(2);

      const channelIndexes = runner.getIndexes('analytics_channel');
      const modelIndexes = runner.getIndexes('analytics_model');

      assert.ok(channelIndexes.includes('idx_analytics_channel_time'), 'idx_analytics_channel_time index should exist');
      assert.ok(modelIndexes.includes('idx_analytics_model_time'), 'idx_analytics_model_time index should exist');
    });

    it('should not create duplicate indexes on re-run', async () => {
      await runner.runMigration(2);
      await runner.runMigration(2); // Run again

      const channelIndexes = runner.getIndexes('analytics_channel');
      const modelIndexes = runner.getIndexes('analytics_model');

      const channelTimeIndexes = channelIndexes.filter(i => i === 'idx_analytics_channel_time');
      const modelTimeIndexes = modelIndexes.filter(i => i === 'idx_analytics_model_time');

      assert.strictEqual(channelTimeIndexes.length, 1, 'should only have one channel_time index');
      assert.strictEqual(modelTimeIndexes.length, 1, 'should only have one model_time index');
    });
  });

  describe('Unique constraints', () => {
    it('should enforce unique constraint on analytics_channel (channel_id, timestamp)', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_channel (channel_id, timestamp, requests)
        VALUES (?, ?, ?)
      `);

      // First insert should succeed
      insert.run('channel-1', 1743123600, 10);

      // Second insert with same channel_id and timestamp should fail
      assert.throws(() => {
        insert.run('channel-1', 1743123600, 20);
      }, /UNIQUE constraint failed/i);
    });

    it('should enforce unique constraint on analytics_model (model, timestamp)', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_model (model, timestamp, requests)
        VALUES (?, ?, ?)
      `);

      // First insert should succeed
      insert.run('gpt-4', 1743123600, 10);

      // Second insert with same model and timestamp should fail
      assert.throws(() => {
        insert.run('gpt-4', 1743123600, 20);
      }, /UNIQUE constraint failed/i);
    });

    it('should allow same channel_id with different timestamps', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_channel (channel_id, timestamp, requests)
        VALUES (?, ?, ?)
      `);

      // Both inserts should succeed
      insert.run('channel-1', 1743123600, 10);
      insert.run('channel-1', 1743127200, 20);

      const count = db.prepare('SELECT COUNT(*) as count FROM analytics_channel').get() as { count: number };
      assert.strictEqual(count.count, 2, 'should have 2 records');
    });

    it('should allow same model with different timestamps', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_model (model, timestamp, requests)
        VALUES (?, ?, ?)
      `);

      // Both inserts should succeed
      insert.run('gpt-4', 1743123600, 10);
      insert.run('gpt-4', 1743127200, 20);

      const count = db.prepare('SELECT COUNT(*) as count FROM analytics_model').get() as { count: number };
      assert.strictEqual(count.count, 2, 'should have 2 records');
    });
  });

  describe('Idempotency', () => {
    it('should be idempotent - running twice should not fail', async () => {
      // First run
      await runner.runMigration(2);

      // Second run should not throw
      await assert.doesNotReject(async () => {
        await runner.runMigration(2);
      });

      // Verify all tables still exist
      const tables = runner.getTables();
      assert.ok(tables.includes('analytics_hourly'), 'analytics_hourly table should exist');
      assert.ok(tables.includes('analytics_daily'), 'analytics_daily table should exist');
      assert.ok(tables.includes('analytics_channel'), 'analytics_channel table should exist');
      assert.ok(tables.includes('analytics_model'), 'analytics_model table should exist');
    });

    it('should record migration in schema_migrations', async () => {
      await runner.runMigration(2);

      const migrations = runner.getAppliedMigrations();
      const migration = migrations.find(m => m.version === 2);

      assert.ok(migration, 'migration should be recorded');
      assert.strictEqual(migration.name, '002_analytics', 'name should match');
      assert.strictEqual(migration.checksum, '6dimensional_analytics_v1', 'checksum should match');
    });

    it('should skip already applied migrations', async () => {
      await runner.runMigration(2);

      // Count migrations before
      const before = runner.getAppliedMigrations().length;

      // Run again
      await runner.runMigration(2);

      // Count should remain the same
      const after = runner.getAppliedMigrations().length;
      assert.strictEqual(after, before, 'should not duplicate migration record');
    });
  });

  describe('Rollback', () => {
    it('should rollback successfully', async () => {
      await runner.runMigration(2);

      // Verify tables exist
      let tables = runner.getTables();
      assert.ok(tables.includes('analytics_hourly'), 'analytics_hourly should exist before rollback');
      assert.ok(tables.includes('analytics_daily'), 'analytics_daily should exist before rollback');
      assert.ok(tables.includes('analytics_channel'), 'analytics_channel should exist before rollback');
      assert.ok(tables.includes('analytics_model'), 'analytics_model should exist before rollback');

      // Rollback
      await runner.rollbackMigration(2);

      // Verify tables are dropped
      tables = runner.getTables();
      assert.ok(!tables.includes('analytics_hourly'), 'analytics_hourly should be dropped after rollback');
      assert.ok(!tables.includes('analytics_daily'), 'analytics_daily should be dropped after rollback');
      assert.ok(!tables.includes('analytics_channel'), 'analytics_channel should be dropped after rollback');
      assert.ok(!tables.includes('analytics_model'), 'analytics_model should be dropped after rollback');
    });

    it('should remove indexes on rollback', async () => {
      await runner.runMigration(2);
      await runner.rollbackMigration(2);

      // Get all indexes in database
      const db = runner.getDatabase();
      const allIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_analytics_%'").all() as Array<{ name: string }>;

      assert.strictEqual(allIndexes.length, 0, 'all analytics indexes should be removed');
    });

    it('should remove migration record on rollback', async () => {
      await runner.runMigration(2);
      await runner.rollbackMigration(2);

      const migrations = runner.getAppliedMigrations();
      const migration = migrations.find(m => m.version === 2);

      assert.ok(!migration, 'migration record should be removed');
    });

    it('should be safe to rollback non-existent migration', async () => {
      await assert.doesNotReject(async () => {
        await runner.rollbackMigration(2);
      });
    });
  });

  describe('Data integrity', () => {
    it('should have default values for required fields in analytics_hourly', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_hourly (hour)
        VALUES (?)
      `);

      insert.run(1743123600);

      const result = db.prepare('SELECT * FROM analytics_hourly LIMIT 1').get() as Record<string, unknown>;

      assert.strictEqual(result.requests, 0, 'requests should default to 0');
      assert.strictEqual(result.input_tokens, 0, 'input_tokens should default to 0');
      assert.strictEqual(result.output_tokens, 0, 'output_tokens should default to 0');
      assert.strictEqual(result.cost, 0, 'cost should default to 0');
    });

    it('should have default values for required fields in analytics_daily', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_daily (day)
        VALUES (?)
      `);

      insert.run(1743123600);

      const result = db.prepare('SELECT * FROM analytics_daily LIMIT 1').get() as Record<string, unknown>;

      assert.strictEqual(result.requests, 0, 'requests should default to 0');
      assert.strictEqual(result.input_tokens, 0, 'input_tokens should default to 0');
      assert.strictEqual(result.output_tokens, 0, 'output_tokens should default to 0');
      assert.strictEqual(result.cost, 0, 'cost should default to 0');
    });

    it('should auto-increment id in analytics_channel', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_channel (channel_id, timestamp)
        VALUES (?, ?)
      `);

      const result1 = insert.run('channel-1', 1743123600);
      const result2 = insert.run('channel-2', 1743123600);

      assert.strictEqual(result1.lastInsertRowid, 1, 'first insert should have id 1');
      assert.strictEqual(result2.lastInsertRowid, 2, 'second insert should have id 2');
    });

    it('should auto-increment id in analytics_model', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_model (model, timestamp)
        VALUES (?, ?)
      `);

      const result1 = insert.run('gpt-4', 1743123600);
      const result2 = insert.run('llama3', 1743123600);

      assert.strictEqual(result1.lastInsertRowid, 1, 'first insert should have id 1');
      assert.strictEqual(result2.lastInsertRowid, 2, 'second insert should have id 2');
    });

    it('should use hour as primary key without auto-increment', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_hourly (hour, requests)
        VALUES (?, ?)
      `);

      insert.run(1743123600, 100);

      const result = db.prepare('SELECT * FROM analytics_hourly WHERE hour = ?').get(1743123600) as Record<string, unknown>;

      assert.strictEqual(result.hour, 1743123600, 'hour should be the provided value');
      assert.strictEqual(result.requests, 100, 'requests should match');
    });

    it('should use day as primary key without auto-increment', async () => {
      await runner.runMigration(2);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO analytics_daily (day, requests)
        VALUES (?, ?)
      `);

      insert.run(1743123600, 100);

      const result = db.prepare('SELECT * FROM analytics_daily WHERE day = ?').get(1743123600) as Record<string, unknown>;

      assert.strictEqual(result.day, 1743123600, 'day should be the provided value');
      assert.strictEqual(result.requests, 100, 'requests should match');
    });
  });
});
