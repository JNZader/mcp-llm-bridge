/**
 * Tests for logging types and schemas
 * 
 * @module test/logging/types
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  LogEntrySchema,
  LogEntryPublicSchema,
  LogQuerySchema,
  LogsResponseSchema,
  LogContextSchema,
  LogCaptureInputSchema,
} from '../../src/logging/schemas.js';

describe('Logging Schemas', () => {
  describe('LogEntrySchema', () => {
    it('should validate a complete log entry', () => {
      const logEntry = {
        id: 1,
        timestamp: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        error: undefined,
        attempts: 1,
        requestData: '{"prompt":"hello"}',
        responseData: '{"text":"world"}',
        createdAt: Date.now(),
      };

      const result = LogEntrySchema.safeParse(logEntry);
      assert.strictEqual(result.success, true);
    });

    it('should validate minimal log entry', () => {
      const logEntry = {
        timestamp: Date.now(),
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        latencyMs: 0,
        attempts: 1,
      };

      const result = LogEntrySchema.safeParse(logEntry);
      assert.strictEqual(result.success, true);
    });

    it('should reject negative token counts', () => {
      const logEntry = {
        timestamp: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: -1,
        outputTokens: 0,
        cost: 0,
        latencyMs: 0,
        attempts: 1,
      };

      const result = LogEntrySchema.safeParse(logEntry);
      assert.strictEqual(result.success, false);
    });

    it('should reject empty provider', () => {
      const logEntry = {
        timestamp: Date.now(),
        provider: '',
        model: 'gpt-4o',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        latencyMs: 0,
        attempts: 1,
      };

      const result = LogEntrySchema.safeParse(logEntry);
      assert.strictEqual(result.success, false);
    });

    it('should set default attempts to 1', () => {
      const logEntry = {
        timestamp: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        latencyMs: 0,
      };

      const result = LogEntrySchema.parse(logEntry);
      assert.strictEqual(result.attempts, 1);
    });
  });

  describe('LogEntryPublicSchema', () => {
    it('should validate public log entry', () => {
      const publicEntry = {
        id: 1,
        timestamp: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        attempts: 1,
      };

      const result = LogEntryPublicSchema.safeParse(publicEntry);
      assert.strictEqual(result.success, true);
    });

    it('should reject extra properties in strict mode', () => {
      const publicEntry = {
        id: 1,
        timestamp: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        latencyMs: 1200,
        attempts: 1,
        extraField: 'should fail',
      };

      const result = LogEntryPublicSchema.safeParse(publicEntry);
      assert.strictEqual(result.success, false);
    });
  });

  describe('LogQuerySchema', () => {
    it('should validate empty query', () => {
      const result = LogQuerySchema.safeParse({});
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.limit, 100);
      assert.strictEqual(result.data?.offset, 0);
    });

    it('should validate complete query', () => {
      const query = {
        from: 1704067200000,
        to: 1706659200000,
        provider: 'openai',
        model: 'gpt-4o',
        limit: 50,
        offset: 100,
      };

      const result = LogQuerySchema.safeParse(query);
      assert.strictEqual(result.success, true);
    });

    it('should reject invalid limit', () => {
      const query = { limit: 1001 };
      const result = LogQuerySchema.safeParse(query);
      assert.strictEqual(result.success, false);
    });

    it('should reject negative offset', () => {
      const query = { offset: -1 };
      const result = LogQuerySchema.safeParse(query);
      assert.strictEqual(result.success, false);
    });

    it('should reject when to is before from', () => {
      const query = {
        from: 1706659200000,
        to: 1704067200000,
      };
      const result = LogQuerySchema.safeParse(query);
      assert.strictEqual(result.success, false);
    });

    it('should accept when to equals from', () => {
      const query = {
        from: 1704067200000,
        to: 1704067200000,
      };
      const result = LogQuerySchema.safeParse(query);
      assert.strictEqual(result.success, true);
    });
  });

  describe('LogsResponseSchema', () => {
    it('should validate empty response', () => {
      const response = {
        logs: [],
        total: 0,
        limit: 100,
        offset: 0,
      };

      const result = LogsResponseSchema.safeParse(response);
      assert.strictEqual(result.success, true);
    });

    it('should validate response with logs', () => {
      const response = {
        logs: [
          {
            id: 1,
            timestamp: Date.now(),
            provider: 'openai',
            model: 'gpt-4o',
            inputTokens: 100,
            outputTokens: 50,
            cost: 0.0025,
            latencyMs: 1200,
            attempts: 1,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      };

      const result = LogsResponseSchema.safeParse(response);
      assert.strictEqual(result.success, true);
    });
  });

  describe('LogContextSchema', () => {
    it('should validate valid context', () => {
      const context = {
        startTime: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = LogContextSchema.safeParse(context);
      assert.strictEqual(result.success, true);
    });

    it('should reject invalid UUID', () => {
      const context = {
        startTime: Date.now(),
        provider: 'openai',
        model: 'gpt-4o',
        requestId: 'not-a-uuid',
      };

      const result = LogContextSchema.safeParse(context);
      assert.strictEqual(result.success, false);
    });
  });

  describe('LogCaptureInputSchema', () => {
    it('should validate complete input', () => {
      const input = {
        context: {
          startTime: Date.now(),
          provider: 'openai',
          model: 'gpt-4o',
          requestId: '550e8400-e29b-41d4-a716-446655440000',
        },
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.0025,
        attempts: 1,
        requestData: { prompt: 'hello' },
        responseData: { text: 'world' },
      };

      const result = LogCaptureInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });

    it('should validate minimal input', () => {
      const input = {
        context: {
          startTime: Date.now(),
          provider: 'openai',
          model: 'gpt-4o',
          requestId: '550e8400-e29b-41d4-a716-446655440000',
        },
        attempts: 2,
      };

      const result = LogCaptureInputSchema.safeParse(input);
      assert.strictEqual(result.success, true);
    });
  });
});
