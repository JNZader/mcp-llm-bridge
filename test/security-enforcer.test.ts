/**
 * ProfileEnforcer tests — tool filtering, authorization, rate limiting,
 * handler wrapping, and CI guard for tool category coverage.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ProfileEnforcer } from '../src/security/enforcer.js';
import { TOOL_CATEGORIES } from '../src/security/profiles.js';

// ── Helpers ────────────────────────────────────────────────

/** Minimal tool definition matching the ToolDef interface. */
function toolDef(name: string) {
  return { name, description: `${name} tool`, inputSchema: { type: 'object' as const, properties: {} } };
}

/** All tool names from the TOOL_CATEGORIES map. */
const ALL_TOOL_NAMES = Object.keys(TOOL_CATEGORIES);

/** Build a full tool list matching the categories map. */
const ALL_TOOLS = ALL_TOOL_NAMES.map(toolDef);

// Track enforcers for cleanup
const enforcers: ProfileEnforcer[] = [];

function createEnforcer(profile: string): ProfileEnforcer {
  const e = new ProfileEnforcer(profile);
  enforcers.push(e);
  return e;
}

afterEach(() => {
  for (const e of enforcers) e.destroy();
  enforcers.length = 0;
});

// ── Constructor ────────────────────────────────────────────

describe('ProfileEnforcer constructor', () => {
  it('throws on unknown profile', () => {
    assert.throws(
      () => new ProfileEnforcer('nonexistent'),
      /Unknown security profile/,
    );
  });

  it('creates enforcer for all valid profiles', () => {
    for (const level of ['local-dev', 'restricted', 'open']) {
      const e = createEnforcer(level);
      assert.equal(e.profile.level, level);
    }
  });
});

// ── filterTools ────────────────────────────────────────────

describe('ProfileEnforcer.filterTools', () => {
  it('local-dev shows all tools', () => {
    const enforcer = createEnforcer('local-dev');
    const filtered = enforcer.filterTools(ALL_TOOLS);
    assert.equal(filtered.length, ALL_TOOLS.length);
  });

  it('restricted shows only read + generate tools', () => {
    const enforcer = createEnforcer('restricted');
    const filtered = enforcer.filterTools(ALL_TOOLS);

    const expectedNames = ALL_TOOL_NAMES.filter((name) => {
      const cat = TOOL_CATEGORIES[name];
      return cat === 'read' || cat === 'generate';
    });

    assert.equal(filtered.length, expectedNames.length);
    for (const tool of filtered) {
      const cat = TOOL_CATEGORIES[tool.name];
      assert.ok(
        cat === 'read' || cat === 'generate',
        `Tool "${tool.name}" (${cat}) should not be visible under restricted`,
      );
    }
  });

  it('open shows only generate tools', () => {
    const enforcer = createEnforcer('open');
    const filtered = enforcer.filterTools(ALL_TOOLS);

    const expectedNames = ALL_TOOL_NAMES.filter(
      (name) => TOOL_CATEGORIES[name] === 'generate',
    );

    assert.equal(filtered.length, expectedNames.length);
    for (const tool of filtered) {
      assert.equal(
        TOOL_CATEGORIES[tool.name],
        'generate',
        `Tool "${tool.name}" should not be visible under open`,
      );
    }
  });

  it('blocks tools not in TOOL_CATEGORIES', () => {
    const enforcer = createEnforcer('local-dev');
    const unknownTool = toolDef('unknown_tool_xyz');
    const filtered = enforcer.filterTools([unknownTool]);
    assert.equal(filtered.length, 0);
  });
});

// ── authorize ──────────────────────────────────────────────

describe('ProfileEnforcer.authorize', () => {
  it('allows tool in permitted category', () => {
    const enforcer = createEnforcer('restricted');
    // llm_generate is 'generate' — allowed under restricted
    assert.equal(enforcer.authorize('llm_generate'), true);
    // vault_list is 'read' — allowed under restricted
    assert.equal(enforcer.authorize('vault_list'), true);
  });

  it('denies tool in blocked category', () => {
    const enforcer = createEnforcer('restricted');
    // vault_store is 'destructive' — blocked under restricted
    assert.equal(enforcer.authorize('vault_store'), false);
    // configure_circuit_breaker is 'admin' — blocked under restricted
    assert.equal(enforcer.authorize('configure_circuit_breaker'), false);
  });

  it('denies unknown tool', () => {
    const enforcer = createEnforcer('local-dev');
    assert.equal(enforcer.authorize('totally_fake_tool'), false);
  });

  it('open profile denies read tools', () => {
    const enforcer = createEnforcer('open');
    assert.equal(enforcer.authorize('vault_list'), false);
    assert.equal(enforcer.authorize('usage_summary'), false);
  });

  it('open profile allows generate tools', () => {
    const enforcer = createEnforcer('open');
    assert.equal(enforcer.authorize('llm_generate'), true);
    assert.equal(enforcer.authorize('llm_models'), true);
  });
});

// ── checkRate ──────────────────────────────────────────────

describe('ProfileEnforcer.checkRate', () => {
  it('local-dev has no rate limit', () => {
    const enforcer = createEnforcer('local-dev');
    // Call 1000 times — should never be limited
    for (let i = 0; i < 1000; i++) {
      const result = enforcer.checkRate();
      assert.equal(result.allowed, true);
    }
  });

  it('open profile allows under limit', () => {
    const enforcer = createEnforcer('open');
    // open has max=10 — first 10 should be allowed
    for (let i = 0; i < 10; i++) {
      const result = enforcer.checkRate();
      assert.equal(result.allowed, true, `Request ${i + 1} should be allowed`);
    }
  });

  it('open profile blocks over limit with retryAfter', () => {
    const enforcer = createEnforcer('open');
    // Exhaust the limit (10 calls)
    for (let i = 0; i < 10; i++) {
      enforcer.checkRate();
    }
    // 11th should be blocked
    const result = enforcer.checkRate();
    assert.equal(result.allowed, false);
    assert.ok(
      typeof result.retryAfter === 'number' && result.retryAfter > 0,
      `Expected retryAfter > 0, got ${result.retryAfter}`,
    );
  });

  it('restricted profile allows under limit', () => {
    const enforcer = createEnforcer('restricted');
    // restricted has max=100 — a few calls should be fine
    for (let i = 0; i < 50; i++) {
      const result = enforcer.checkRate();
      assert.equal(result.allowed, true);
    }
  });
});

// ── wrapHandlers integration ───────────────────────────────

describe('ProfileEnforcer.wrapHandlers', () => {
  /**
   * Minimal mock server that records setRequestHandler calls.
   * We only need to verify the enforcer correctly intercepts.
   */
  function createMockServer() {
    const handlers = new Map<unknown, (req: unknown) => Promise<unknown>>();
    return {
      setRequestHandler(schema: unknown, handler: (req: unknown) => Promise<unknown>) {
        handlers.set(schema, handler);
      },
      getHandler(schema: unknown) {
        return handlers.get(schema);
      },
    };
  }

  it('blocked tool returns MCP error via wrapped CallTool handler', async () => {
    const enforcer = createEnforcer('open');
    const mockServer = createMockServer();

    const mockHandleToolCall = async (_name: string, _args: Record<string, unknown>) => ({
      content: [{ type: 'text' as const, text: 'should not reach here' }],
    });

    // We need the actual schema references to look them up
    const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
      '@modelcontextprotocol/sdk/types.js'
    );

    enforcer.wrapHandlers(
      mockServer as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server,
      ALL_TOOLS,
      mockHandleToolCall,
    );

    // Verify ListTools returns filtered tools
    const listHandler = mockServer.getHandler(ListToolsRequestSchema);
    assert.ok(listHandler, 'ListTools handler should be registered');
    const listResult = (await listHandler({})) as { tools: Array<{ name: string }> };
    // open profile: only generate tools
    for (const tool of listResult.tools) {
      assert.equal(
        TOOL_CATEGORIES[tool.name],
        'generate',
        `Listed tool "${tool.name}" should be generate category`,
      );
    }

    // Verify CallTool blocks a destructive tool
    const callHandler = mockServer.getHandler(CallToolRequestSchema);
    assert.ok(callHandler, 'CallTool handler should be registered');

    const blockedResult = (await callHandler({
      params: { name: 'vault_store', arguments: { provider: 'test', apiKey: 'key' } },
    })) as { content: Array<{ text: string }>; isError: boolean };

    assert.equal(blockedResult.isError, true);
    assert.ok(blockedResult.content[0]!.text.includes('Access denied'));
  });

  it('allowed tool delegates to handleToolCall', async () => {
    const enforcer = createEnforcer('restricted');
    const mockServer = createMockServer();

    let delegatedName = '';
    const mockHandleToolCall = async (name: string, _args: Record<string, unknown>) => {
      delegatedName = name;
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    };

    const { CallToolRequestSchema } = await import(
      '@modelcontextprotocol/sdk/types.js'
    );

    enforcer.wrapHandlers(
      mockServer as unknown as import('@modelcontextprotocol/sdk/server/index.js').Server,
      ALL_TOOLS,
      mockHandleToolCall,
    );

    const callHandler = mockServer.getHandler(CallToolRequestSchema);
    assert.ok(callHandler);

    // llm_generate is 'generate' — allowed under restricted
    const result = (await callHandler({
      params: { name: 'llm_generate', arguments: { prompt: 'hello' } },
    })) as { content: Array<{ text: string }> };

    assert.equal(delegatedName, 'llm_generate');
    assert.equal(result.content[0]!.text, 'ok');
  });
});

// ── CI Guard: TOOL_CATEGORIES covers all registered tools ──

describe('CI Guard: TOOL_CATEGORIES coverage', () => {
  it('every tool in mcp.ts TOOLS array has a category mapping', async () => {
    // Dynamically import to get the TOOLS constant
    // We can't import TOOLS directly since it's not exported,
    // so we verify against our known list of tool names from the source.
    const expectedToolNames = [
      'llm_generate',
      'llm_models',
      'vault_store',
      'vault_list',
      'vault_delete',
      'vault_store_file',
      'vault_list_files',
      'vault_delete_file',
      'list_groups',
      'create_group',
      'delete_group',
      'configure_circuit_breaker',
      'circuit_breaker_stats',
      'usage_summary',
      'usage_query',
      'code_search',
      'index_codebase',
      'shared_state',
    ];

    const categoryToolNames = Object.keys(TOOL_CATEGORIES);

    // Every registered tool must have a category
    for (const name of expectedToolNames) {
      assert.ok(
        categoryToolNames.includes(name),
        `Registered tool "${name}" is missing from TOOL_CATEGORIES — add it!`,
      );
    }

    // Every categorized tool must be a registered tool (no stale entries)
    for (const name of categoryToolNames) {
      assert.ok(
        expectedToolNames.includes(name),
        `TOOL_CATEGORIES has stale entry "${name}" — tool no longer registered in mcp.ts`,
      );
    }
  });
});
