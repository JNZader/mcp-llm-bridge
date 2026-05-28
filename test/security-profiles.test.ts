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
import { getRuntimeMcpTools } from '../src/server/mcp.js';

// ── Zod Schema Validation ──────────────────────────────────

describe('SecurityProfileSchema', () => {
  it('accepts a valid profile with rate limit', () => {
    const result = SecurityProfileSchema.safeParse({
      level: 'restricted',
      allowedCategories: ['read', 'generate'],
      rateLimit: { max: 100, windowMs: 900_000 },
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.sandbox, false, 'default sandbox should be false');
    }
  });

  it('accepts a valid profile with null rate limit', () => {
    const result = SecurityProfileSchema.safeParse({
      level: 'local-dev',
      allowedCategories: ['destructive', 'read', 'generate', 'admin'],
      rateLimit: null,
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.sandbox, false, 'default sandbox should be false');
    }
  });

  it('accepts a profile with sandbox true', () => {
    const result = SecurityProfileSchema.safeParse({
      level: 'restricted',
      allowedCategories: ['read'],
      rateLimit: null,
      sandbox: true,
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.sandbox, true);
    }
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
  it('covers the runtime MCP tool registry exactly', () => {
    const runtimeToolNames = getRuntimeMcpTools().map((tool) => tool.name).sort();
    const categorizedToolNames = Object.keys(TOOL_CATEGORIES).sort();

    assert.deepEqual(
      categorizedToolNames,
      runtimeToolNames,
      'TOOL_CATEGORIES must match the exported runtime MCP tool registry',
    );
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

  it('maps conversation tools to read', () => {
    const conversationTools = getRuntimeMcpTools()
      .map((tool) => tool.name)
      .filter((name) => name.startsWith('conversation_'))
      .sort();

    assert.deepEqual(conversationTools, [
      'conversation_check_compaction',
      'conversation_context',
      'conversation_find_relevant',
      'conversation_get_page',
      'conversation_info',
      'conversation_navigate',
      'conversation_paginate',
    ]);

    for (const name of conversationTools) {
      assert.equal(
        TOOL_CATEGORIES[name],
        'read',
        `Conversation tool "${name}" should be read-only`,
      );
    }
  });

  it('keeps sensitive tools in their intended categories', () => {
    const expectedCategories = {
      llm_generate: 'generate',
      llm_models: 'generate',
      local_llm_generate: 'generate',
      vault_store: 'destructive',
      vault_delete: 'destructive',
      vault_store_file: 'destructive',
      vault_delete_file: 'destructive',
      create_group: 'destructive',
      delete_group: 'destructive',
      approval_approve: 'destructive',
      approval_deny: 'destructive',
      vault_list: 'read',
      vault_list_files: 'read',
      usage_summary: 'read',
      usage_query: 'read',
      code_search: 'read',
      approval_list: 'read',
      discover_models: 'read',
      configure_circuit_breaker: 'admin',
      index_codebase: 'admin',
      shared_state: 'admin',
    } as const;

    for (const [toolName, category] of Object.entries(expectedCategories)) {
      assert.equal(
        TOOL_CATEGORIES[toolName],
        category,
        `Tool "${toolName}" should stay in category "${category}"`,
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

  it('local-dev allows all categories with no rate limit and sandbox false', () => {
    const p = PROFILES['local-dev'];
    assert.deepEqual(
      [...p.allowedCategories].sort(),
      ['admin', 'destructive', 'generate', 'read'],
    );
    assert.equal(p.rateLimit, null);
    assert.equal(p.sandbox, false);
  });

  it('restricted allows read + generate with rate limit and sandbox false', () => {
    const p = PROFILES['restricted'];
    assert.deepEqual([...p.allowedCategories].sort(), ['generate', 'read']);
    assert.notEqual(p.rateLimit, null);
    assert.equal(p.rateLimit!.max, 100);
    assert.equal(p.rateLimit!.windowMs, 15 * 60 * 1000);
    assert.equal(p.sandbox, false);
  });

  it('open allows only generate with stricter rate limit and sandbox false', () => {
    const p = PROFILES['open'];
    assert.deepEqual([...p.allowedCategories], ['generate']);
    assert.notEqual(p.rateLimit, null);
    assert.equal(p.rateLimit!.max, 10);
    assert.equal(p.rateLimit!.windowMs, 15 * 60 * 1000);
    assert.equal(p.sandbox, false);
  });
});
