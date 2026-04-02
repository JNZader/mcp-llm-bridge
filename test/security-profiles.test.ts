/**
 * Security Profiles tests — Zod schemas, tool categories, and profile definitions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ToolCategorySchema,
  TrustLevelSchema,
  SecurityProfileSchema,
  RateLimitConfigSchema,
  TOOL_CATEGORIES,
  PROFILES,
} from '../src/security/profiles.js';

// ── Zod Schema Validation ──────────────────────────────────

describe('SecurityProfileSchema', () => {
  it('accepts a valid profile with rate limit', () => {
    const result = SecurityProfileSchema.safeParse({
      level: 'restricted',
      allowedCategories: ['read', 'generate'],
      rateLimit: { max: 100, windowMs: 900_000 },
    });
    assert.equal(result.success, true);
  });

  it('accepts a valid profile with null rate limit', () => {
    const result = SecurityProfileSchema.safeParse({
      level: 'local-dev',
      allowedCategories: ['destructive', 'read', 'generate', 'admin'],
      rateLimit: null,
    });
    assert.equal(result.success, true);
  });

  it('rejects unknown trust level', () => {
    const result = SecurityProfileSchema.safeParse({
      level: 'super-admin',
      allowedCategories: ['read'],
      rateLimit: null,
    });
    assert.equal(result.success, false);
  });

  it('rejects empty allowedCategories', () => {
    const result = SecurityProfileSchema.safeParse({
      level: 'open',
      allowedCategories: [],
      rateLimit: null,
    });
    assert.equal(result.success, false);
  });

  it('rejects unknown category', () => {
    const result = SecurityProfileSchema.safeParse({
      level: 'open',
      allowedCategories: ['nuclear'],
      rateLimit: null,
    });
    assert.equal(result.success, false);
  });

  it('rejects negative rate limit max', () => {
    const result = RateLimitConfigSchema.safeParse({ max: -1, windowMs: 1000 });
    assert.equal(result.success, false);
  });

  it('rejects zero windowMs', () => {
    const result = RateLimitConfigSchema.safeParse({ max: 10, windowMs: 0 });
    assert.equal(result.success, false);
  });
});

describe('TrustLevelSchema', () => {
  it('accepts all valid trust levels', () => {
    for (const level of ['local-dev', 'restricted', 'open']) {
      const result = TrustLevelSchema.safeParse(level);
      assert.equal(result.success, true, `Expected "${level}" to be valid`);
    }
  });

  it('rejects invalid trust level', () => {
    const result = TrustLevelSchema.safeParse('admin');
    assert.equal(result.success, false);
  });
});

describe('ToolCategorySchema', () => {
  it('accepts all valid categories', () => {
    for (const cat of ['destructive', 'read', 'generate', 'admin']) {
      const result = ToolCategorySchema.safeParse(cat);
      assert.equal(result.success, true, `Expected "${cat}" to be valid`);
    }
  });

  it('rejects invalid category', () => {
    const result = ToolCategorySchema.safeParse('write');
    assert.equal(result.success, false);
  });
});

// ── TOOL_CATEGORIES map ────────────────────────────────────

describe('TOOL_CATEGORIES', () => {
  it('has exactly 18 tools mapped', () => {
    const count = Object.keys(TOOL_CATEGORIES).length;
    assert.equal(count, 18, `Expected 18 tools, got ${count}`);
  });

  it('maps every tool to a valid category', () => {
    const validCategories = new Set(['destructive', 'read', 'generate', 'admin']);
    for (const [tool, category] of Object.entries(TOOL_CATEGORIES)) {
      assert.ok(
        validCategories.has(category),
        `Tool "${tool}" has invalid category "${category}"`,
      );
    }
  });

  it('contains expected tool names', () => {
    const expectedTools = [
      'llm_generate',
      'llm_models',
      'vault_store',
      'vault_delete',
      'vault_store_file',
      'vault_delete_file',
      'vault_list',
      'vault_list_files',
      'list_groups',
      'create_group',
      'delete_group',
      'circuit_breaker_stats',
      'usage_summary',
      'usage_query',
      'code_search',
      'configure_circuit_breaker',
      'index_codebase',
      'shared_state',
    ];
    for (const name of expectedTools) {
      assert.ok(
        name in TOOL_CATEGORIES,
        `Expected tool "${name}" in TOOL_CATEGORIES`,
      );
    }
  });
});

// ── PROFILES definitions ───────────────────────────────────

describe('PROFILES', () => {
  it('has all three trust levels', () => {
    assert.ok('local-dev' in PROFILES);
    assert.ok('restricted' in PROFILES);
    assert.ok('open' in PROFILES);
  });

  it('local-dev allows all categories with no rate limit', () => {
    const p = PROFILES['local-dev'];
    assert.deepEqual(
      [...p.allowedCategories].sort(),
      ['admin', 'destructive', 'generate', 'read'],
    );
    assert.equal(p.rateLimit, null);
  });

  it('restricted allows read + generate with rate limit', () => {
    const p = PROFILES['restricted'];
    assert.deepEqual([...p.allowedCategories].sort(), ['generate', 'read']);
    assert.notEqual(p.rateLimit, null);
    assert.equal(p.rateLimit!.max, 100);
    assert.equal(p.rateLimit!.windowMs, 15 * 60 * 1000);
  });

  it('open allows only generate with stricter rate limit', () => {
    const p = PROFILES['open'];
    assert.deepEqual([...p.allowedCategories], ['generate']);
    assert.notEqual(p.rateLimit, null);
    assert.equal(p.rateLimit!.max, 10);
    assert.equal(p.rateLimit!.windowMs, 15 * 60 * 1000);
  });
});
