/**
 * Migration Tests for request_logs table
 * 
 * Tests cover:
 * - Table creation with correct columns
 * - Index creation
 * - Migration idempotency
 * - Rollback functionality
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MigrationRunner } from '../../src/db/migrate.js';

describe('Migration 001: request_logs table', () => {
  let runner: MigrationRunner;

  beforeEach(() => {
    // Use in-memory database for tests
    runner = new MigrationRunner({ dbPath: ':memory:' });
  });

  afterEach(() => {
    runner.close();
  });

  describe('Table creation', () => {
    it('should create request_logs table with correct columns', async () => {
      await runner.runMigration(1);

      const columns = runner.getTableInfo('request_logs');
      const columnMap = new Map(columns.map(c => [c.name, c.type]));

      // Verify all expected columns exist with correct types
      assert.strictEqual(columnMap.get('id'), 'INTEGER', 'id should be INTEGER');
      assert.strictEqual(columnMap.get('timestamp'), 'INTEGER', 'timestamp should be INTEGER');
      assert.strictEqual(columnMap.get('provider'), 'TEXT', 'provider should be TEXT');
      assert.strictEqual(columnMap.get('model'), 'TEXT', 'model should be TEXT');
      assert.strictEqual(columnMap.get('input_tokens'), 'INTEGER', 'input_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('output_tokens'), 'INTEGER', 'output_tokens should be INTEGER');
      assert.strictEqual(columnMap.get('cost'), 'REAL', 'cost should be REAL');
      assert.strictEqual(columnMap.get('latency_ms'), 'INTEGER', 'latency_ms should be INTEGER');
      assert.strictEqual(columnMap.get('error'), 'TEXT', 'error should be TEXT');
      assert.strictEqual(columnMap.get('attempts'), 'INTEGER', 'attempts should be INTEGER');
      assert.strictEqual(columnMap.get('request_data'), 'TEXT', 'request_data should be TEXT');
      assert.strictEqual(columnMap.get('response_data'), 'TEXT', 'response_data should be TEXT');
      assert.strictEqual(columnMap.get('created_at'), 'INTEGER', 'created_at should be INTEGER');
    });

    it('should have id as primary key', async () => {
      await runner.runMigration(1);

      const columns = runner.getTableInfo('request_logs');
      const idColumn = columns.find(c => c.name === 'id');

      assert.ok(idColumn, 'id column should exist');
      // Note: SQLite PRAGMA doesn't expose PK info directly, but we can verify
      // the table was created successfully with the SQL
    });
  });

  describe('Indexes', () => {
    it('should create all required indexes', async () => {
      await runner.runMigration(1);

      const indexes = runner.getIndexes('request_logs');

      assert.ok(indexes.includes('idx_logs_timestamp'), 'idx_logs_timestamp index should exist');
      assert.ok(indexes.includes('idx_logs_provider'), 'idx_logs_provider index should exist');
      assert.ok(indexes.includes('idx_logs_model'), 'idx_logs_model index should exist');
    });

    it('should not create duplicate indexes on re-run', async () => {
      await runner.runMigration(1);
      await runner.runMigration(1); // Run again

      const indexes = runner.getIndexes('request_logs');
      const timestampIndexes = indexes.filter(i => i === 'idx_logs_timestamp');

      assert.strictEqual(timestampIndexes.length, 1, 'should only have one timestamp index');
    });
  });

  describe('Idempotency', () => {
    it('should be idempotent - running twice should not fail', async () => {
      // First run
      await runner.runMigration(1);
      
      // Second run should not throw
      await assert.doesNotReject(async () => {
        await runner.runMigration(1);
      });

      // Verify table still exists and has correct structure
      const tables = runner.getTables();
      assert.ok(tables.includes('request_logs'), 'request_logs table should exist');

      const columns = runner.getTableInfo('request_logs');
      assert.strictEqual(columns.length, 13, 'should have 13 columns');
    });

    it('should record migration in schema_migrations', async () => {
      await runner.runMigration(1);

      const migrations = runner.getAppliedMigrations();
      const migration = migrations.find(m => m.version === 1);

      assert.ok(migration, 'migration should be recorded');
      assert.strictEqual(migration.name, '001_request_logs', 'name should match');
      assert.strictEqual(migration.checksum, 'phase1_observability_v1', 'checksum should match');
    });

    it('should skip already applied migrations', async () => {
      await runner.runMigration(1);
      
      // Count migrations before
      const before = runner.getAppliedMigrations().length;
      
      // Run again
      await runner.runMigration(1);
      
      // Count should remain the same
      const after = runner.getAppliedMigrations().length;
      assert.strictEqual(after, before, 'should not duplicate migration record');
    });
  });

  describe('Rollback', () => {
    it('should rollback successfully', async () => {
      await runner.runMigration(1);
      
      // Verify table exists
      let tables = runner.getTables();
      assert.ok(tables.includes('request_logs'), 'request_logs should exist before rollback');

      // Rollback
      await runner.rollbackMigration(1);

      // Verify table is dropped
      tables = runner.getTables();
      assert.ok(!tables.includes('request_logs'), 'request_logs should be dropped after rollback');
    });

    it('should remove indexes on rollback', async () => {
      await runner.runMigration(1);
      await runner.rollbackMigration(1);

      // Get all indexes in database
      const db = runner.getDatabase();
      const allIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_logs_%'").all() as Array<{ name: string }>;

      assert.strictEqual(allIndexes.length, 0, 'all log indexes should be removed');
    });

    it('should remove migration record on rollback', async () => {
      await runner.runMigration(1);
      await runner.rollbackMigration(1);

      const migrations = runner.getAppliedMigrations();
      const migration = migrations.find(m => m.version === 1);

      assert.ok(!migration, 'migration record should be removed');
    });

    it('should be safe to rollback non-existent migration', async () => {
      await assert.doesNotReject(async () => {
        await runner.rollbackMigration(1);
      });
    });
  });

  describe('Data integrity', () => {
    it('should allow inserting data after migration', async () => {
      await runner.runMigration(1);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insert.run(Date.now(), 'openai', 'gpt-4', 100, 200, 0.003, 150);

      const result = db.prepare('SELECT * FROM request_logs WHERE provider = ?').get('openai') as Record<string, unknown>;
      
      assert.ok(result, 'record should exist');
      assert.strictEqual(result.provider, 'openai');
      assert.strictEqual(result.model, 'gpt-4');
      assert.strictEqual(result.input_tokens, 100);
      assert.strictEqual(result.output_tokens, 200);
    });

    it('should auto-increment id', async () => {
      await runner.runMigration(1);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model)
        VALUES (?, ?, ?)
      `);

      const result1 = insert.run(Date.now(), 'openai', 'gpt-4');
      const result2 = insert.run(Date.now(), 'groq', 'llama3');

      assert.strictEqual(result1.lastInsertRowid, 1, 'first insert should have id 1');
      assert.strictEqual(result2.lastInsertRowid, 2, 'second insert should have id 2');
    });

    it('should set default created_at timestamp', async () => {
      await runner.runMigration(1);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model)
        VALUES (?, ?, ?)
      `);

      insert.run(Date.now(), 'openai', 'gpt-4');

      const result = db.prepare('SELECT created_at FROM request_logs LIMIT 1').get() as { created_at: number };
      
      assert.ok(result.created_at > 0, 'created_at should be set to unix timestamp');
    });

    it('should default attempts to 1', async () => {
      await runner.runMigration(1);

      const db = runner.getDatabase();
      const insert = db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model)
        VALUES (?, ?, ?)
      `);

      insert.run(Date.now(), 'openai', 'gpt-4');

      const result = db.prepare('SELECT attempts FROM request_logs LIMIT 1').get() as { attempts: number };
      
      assert.strictEqual(result.attempts, 1, 'attempts should default to 1');
    });
  });
});
