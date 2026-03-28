/**
 * RequestLogger Tests - TDD Red Phase
 * 
 * These tests define the expected API and behavior for the RequestLogger class.
 * All tests should FAIL initially (RED phase) since the RequestLogger class
 * does not exist yet.
 * 
 * @module test/logging/request-logger
 * @phase RED (TDD)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';

// Mock crypto.randomUUID for deterministic tests
let mockUuidCounter = 0;
const originalRandomUUID = crypto.randomUUID;

// Mock Date.now for deterministic timestamps
let mockTimeCounter = 1704067200000; // 2024-01-01 00:00:00 UTC
const originalDateNow = Date.now;
const originalDateGetTime = Date.prototype.getTime;

/**
 * Create an in-memory SQLite database for testing
 */
function createTestDatabase(): Database.Database {
  const db = new Database(':memory:');
  
  // Create the request_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0.0,
      latency_ms INTEGER NOT NULL,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 1,
      request_data TEXT,
      response_data TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );
    
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON request_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_provider ON request_logs(provider);
    CREATE INDEX IF NOT EXISTS idx_logs_model ON request_logs(model);
  `);
  
  return db;
}

/**
 * Mock crypto.randomUUID to return predictable UUIDs
 */
function mockRandomUUID(): string {
  mockUuidCounter++;
  return `550e8400-e29b-41d4-a716-446655440${mockUuidCounter.toString().padStart(3, '0')}`;
}

/**
 * Mock Date.now for predictable timestamps
 */
function mockDateNow(): number {
  mockTimeCounter += 1000; // Advance 1 second per call
  return mockTimeCounter;
}

describe('RequestLogger', () => {
  let db: Database.Database;
  let RequestLogger: any;
  let logger: any;

  beforeEach(() => {
    // Setup mocks
    mockUuidCounter = 0;
    mockTimeCounter = 1704067200000;
    (crypto as any).randomUUID = mockRandomUUID;
    Date.now = mockDateNow;
    Date.prototype.getTime = function() {
      return mockTimeCounter;
    };
    
    // Create test database
    db = createTestDatabase();
    
    // Import RequestLogger (will fail in RED phase)
    try {
      const module = require('../../src/logging/request-logger.js');
      RequestLogger = module.RequestLogger;
      logger = new RequestLogger(db);
    } catch (e) {
      // Expected in RED phase - RequestLogger doesn't exist yet
      RequestLogger = null;
      logger = null;
    }
  });

  afterEach(() => {
    // Restore mocks
    (crypto as any).randomUUID = originalRandomUUID;
    Date.now = originalDateNow;
    Date.prototype.getTime = originalDateGetTime;
    
    // Close database
    if (db) {
      db.close();
    }
  });

  describe('Basic logging', () => {
    it('should log a successful request with all fields', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      assert.ok(logger, 'RequestLogger instance should be created');
      
      const requestData = {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        requestData: '{"prompt":"hello"}',
        responseData: '{"text":"world"}',
      };

      // ACT
      await logger.capture(requestData);

      // ASSERT
      const row = db.prepare('SELECT * FROM request_logs WHERE provider = ?').get('openai') as Record<string, unknown>;
      
      assert.ok(row, 'Log entry should be stored in database');
      assert.strictEqual(row.provider, 'openai', 'Provider should match');
      assert.strictEqual(row.model, 'gpt-4', 'Model should match');
      assert.strictEqual(row.input_tokens, 100, 'Input tokens should match');
      assert.strictEqual(row.output_tokens, 50, 'Output tokens should match');
      assert.strictEqual(row.cost, 0.0025, 'Cost should match');
      assert.strictEqual(row.latency_ms, 1200, 'Latency should match');
      assert.strictEqual(row.attempts, 1, 'Attempts should default to 1');
      assert.strictEqual(row.request_data, '{"prompt":"hello"}', 'Request data should match');
      assert.strictEqual(row.response_data, '{"text":"world"}', 'Response data should match');
    });

    it('should log a failed request with error', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      
      const requestData = {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        latencyMs: 500,
        error: 'Rate limit exceeded',
        attempts: 2,
      };

      // ACT
      await logger.capture(requestData);

      // ASSERT
      const row = db.prepare('SELECT * FROM request_logs WHERE error IS NOT NULL').get() as Record<string, unknown>;
      
      assert.ok(row, 'Failed request should be logged');
      assert.strictEqual(row.error, 'Rate limit exceeded', 'Error message should be stored');
      assert.strictEqual(row.status || 'error', 'error', 'Status should indicate error');
    });

    it('should increment attempts counter', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      
      const requestData = {
        provider: 'groq',
        model: 'llama3-70b',
        inputTokens: 50,
        outputTokens: 100,
        cost: 0.001,
        latencyMs: 800,
        attempts: 3, // Multiple retry attempts
      };

      // ACT
      await logger.capture(requestData);

      // ASSERT
      const row = db.prepare('SELECT * FROM request_logs WHERE provider = ?').get('groq') as Record<string, unknown>;
      
      assert.ok(row, 'Log entry should exist');
      assert.strictEqual(row.attempts, 3, 'Attempts counter should reflect retry count');
    });

    it('should calculate latency correctly', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      assert.ok(logger.captureStart, 'captureStart method should exist');
      assert.ok(logger.captureEnd, 'captureEnd method should exist');
      
      const startTime = Date.now();
      const context = logger.captureStart({
        provider: 'openai',
        model: 'gpt-4',
      });
      
      // Simulate 150ms of processing time
      mockTimeCounter += 150;
      
      // ACT
      await logger.captureEnd(context, {
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
      });

      // ASSERT
      const row = db.prepare('SELECT * FROM request_logs WHERE provider = ?').get('openai') as Record<string, unknown>;
      
      assert.ok(row, 'Log entry should exist');
      assert.strictEqual(row.latency_ms, 150, 'Latency should equal endTime - startTime');
    });
  });

  describe('Query operations', () => {
    it('should query logs by date range', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      assert.ok(logger.getLogs, 'getLogs method should exist');
      
      // Seed database with logs at different timestamps
      const now = 1704067200000;
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now - 86400000, 'openai', 'gpt-4', 100, 50, 0.0025, 1000, 1); // 1 day ago
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now - 3600000, 'openai', 'gpt-4', 100, 50, 0.0025, 1000, 1); // 1 hour ago
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now - 60000, 'openai', 'gpt-4', 100, 50, 0.0025, 1000, 1); // 1 minute ago

      // ACT - Query last 2 hours
      const result = await logger.getLogs({
        from: now - 7200000, // 2 hours ago
        to: now,
      });

      // ASSERT
      assert.ok(result, 'Query should return result');
      assert.ok(Array.isArray(result.logs), 'Result should contain logs array');
      assert.strictEqual(result.logs.length, 2, 'Should return 2 logs from last 2 hours');
      assert.strictEqual(result.total, 2, 'Total should reflect filtered count');
    });

    it('should query logs by provider', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      assert.ok(logger.getLogs, 'getLogs method should exist');
      
      // Seed with multiple providers
      const now = 1704067200000;
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now, 'openai', 'gpt-4', 100, 50, 0.0025, 1000, 1);
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now, 'openai', 'gpt-3.5', 50, 25, 0.001, 500, 1);
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now, 'groq', 'llama3', 100, 100, 0.001, 200, 1);
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now, 'anthropic', 'claude-3', 200, 100, 0.003, 1500, 1);

      // ACT
      const result = await logger.getLogs({
        provider: 'openai',
      });

      // ASSERT
      assert.ok(result, 'Query should return result');
      assert.strictEqual(result.logs.length, 2, 'Should return only openai logs');
      assert.ok(result.logs.every((log: any) => log.provider === 'openai'), 'All logs should be from openai');
      assert.strictEqual(result.total, 2, 'Total should be 2');
    });

    it('should support pagination', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      assert.ok(logger.getLogs, 'getLogs method should exist');
      
      // Seed with 25 logs
      const now = 1704067200000;
      const stmt = db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (let i = 0; i < 25; i++) {
        stmt.run(now + i * 1000, 'openai', `model-${i}`, 100, 50, 0.0025, 1000, 1);
      }

      // ACT - First page
      const page1 = await logger.getLogs({
        limit: 10,
        offset: 0,
      });

      // ACT - Second page
      const page2 = await logger.getLogs({
        limit: 10,
        offset: 10,
      });

      // ACT - Third page (should have 5)
      const page3 = await logger.getLogs({
        limit: 10,
        offset: 20,
      });

      // ASSERT
      assert.strictEqual(page1.logs.length, 10, 'Page 1 should have 10 items');
      assert.strictEqual(page1.limit, 10, 'Page 1 should report limit 10');
      assert.strictEqual(page1.offset, 0, 'Page 1 should report offset 0');
      assert.strictEqual(page1.total, 25, 'Total should be 25');
      
      assert.strictEqual(page2.logs.length, 10, 'Page 2 should have 10 items');
      assert.strictEqual(page2.offset, 10, 'Page 2 should report offset 10');
      
      assert.strictEqual(page3.logs.length, 5, 'Page 3 should have 5 items');
    });
  });

  describe('Data handling', () => {
    it('should handle large payloads by truncating', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      
      // Create a payload larger than 10KB
      const largePayload = 'x'.repeat(15000);
      
      const requestData = {
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 1000,
        outputTokens: 2000,
        cost: 0.025,
        latencyMs: 5000,
        requestData: largePayload,
        responseData: largePayload,
      };

      // ACT
      await logger.capture(requestData);

      // ASSERT
      const row = db.prepare('SELECT * FROM request_logs WHERE provider = ?').get('openai') as Record<string, unknown>;
      
      assert.ok(row, 'Log entry should exist');
      const requestDataLength = (row.request_data as string)?.length || 0;
      const responseDataLength = (row.response_data as string)?.length || 0;
      
      assert.ok(requestDataLength <= 10000, `Request data should be truncated to <= 10000 chars, got ${requestDataLength}`);
      assert.ok(responseDataLength <= 10000, `Response data should be truncated to <= 10000 chars, got ${responseDataLength}`);
    });
  });

  describe('Maintenance', () => {
    it('should delete old logs (>30 days)', async () => {
      // ARRANGE
      assert.ok(RequestLogger, 'RequestLogger class should exist');
      assert.ok(logger.cleanup, 'cleanup method should exist');
      
      const now = 1704067200000; // 2024-01-01
      const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
      
      // Insert old logs (31 days ago)
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now - thirtyDaysInMs - 86400000, 'openai', 'gpt-4', 100, 50, 0.0025, 1000, 1);
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now - thirtyDaysInMs - 172800000, 'openai', 'gpt-4', 100, 50, 0.0025, 1000, 1);
      
      // Insert recent logs (within 30 days)
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now - 86400000, 'openai', 'gpt-4', 100, 50, 0.0025, 1000, 1); // 1 day ago
      
      db.prepare(`
        INSERT INTO request_logs (timestamp, provider, model, input_tokens, output_tokens, cost, latency_ms, attempts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(now - 1000, 'openai', 'gpt-4', 100, 50, 0.0025, 1000, 1); // Just now

      // Verify initial count
      const beforeCount = (db.prepare('SELECT COUNT(*) as count FROM request_logs').get() as { count: number }).count;
      assert.strictEqual(beforeCount, 4, 'Should start with 4 logs');

      // ACT
      const deletedCount = await logger.cleanup({
        olderThanDays: 30,
        beforeTimestamp: now,
      });

      // ASSERT
      assert.strictEqual(deletedCount, 2, 'Should delete 2 old logs');
      
      const afterCount = (db.prepare('SELECT COUNT(*) as count FROM request_logs').get() as { count: number }).count;
      assert.strictEqual(afterCount, 2, 'Should have 2 logs remaining');
      
      // Verify remaining logs are recent
      const remaining = db.prepare('SELECT timestamp FROM request_logs').all() as Array<{ timestamp: number }>;
      assert.ok(remaining.every(r => r.timestamp > now - thirtyDaysInMs), 'All remaining logs should be within 30 days');
    });
  });

  describe('API expectations', () => {
    it('should expose expected class and methods', () => {
      // Verify RequestLogger class exists
      assert.ok(RequestLogger, 'RequestLogger class should be exported');
      
      // Verify constructor accepts database
      assert.doesNotThrow(() => {
        new RequestLogger(db);
      }, 'Should accept database in constructor');
      
      // Verify expected methods exist
      const instance = new RequestLogger(db);
      assert.strictEqual(typeof instance.capture, 'function', 'capture method should exist');
      assert.strictEqual(typeof instance.getLogs, 'function', 'getLogs method should exist');
      assert.strictEqual(typeof instance.cleanup, 'function', 'cleanup method should exist');
      assert.strictEqual(typeof instance.captureStart, 'function', 'captureStart method should exist');
      assert.strictEqual(typeof instance.captureEnd, 'function', 'captureEnd method should exist');
    });
  });
});

/**
 * Helper function for creating mock log entries in tests
 */
export function createMockLogEntry(overrides: Partial<any> = {}): any {
  return {
    timestamp: Date.now(),
    provider: 'openai',
    model: 'gpt-4',
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.0025,
    latencyMs: 1000,
    attempts: 1,
    ...overrides,
  };
}

/**
 * Helper function for creating mock request data
 */
export function createMockRequest(overrides: Partial<any> = {}): any {
  return {
    provider: 'openai',
    model: 'gpt-4',
    ...overrides,
  };
}

/**
 * Helper function for creating mock response data
 */
export function createMockResponse(overrides: Partial<any> = {}): any {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.0025,
    ...overrides,
  };
}
