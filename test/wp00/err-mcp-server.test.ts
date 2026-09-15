import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CodeSearchService } from '../../src/code-search/index.js';
import type { Router } from '../../src/core/router.js';
import type { StateManager } from '../../src/crdt/index.js';
import { dispatchToolCall, type McpDispatchContext } from '../../src/server/mcp-dispatcher.js';
import {
  handleApprovalTool,
  handleCodeSearchTool,
  handleGroupStoreTool,
  handlePageIndexTool,
  handleSharedStateTool,
  handleUsageTool,
  type McpToolResult,
} from '../../src/server/mcp-tool-handlers.js';
import type { Vault } from '../../src/vault/vault.js';

const CANARY = 'raw-mcp-server-handler-canary';
const SAFE_MCP_FAILURE = {
  error: 'An unexpected internal error occurred.',
  code: 'INTERNAL_ERROR',
};

function assertSafeMcpFailure(result: McpToolResult): void {
  assert.deepEqual(result, {
    content: [{ type: 'text', text: JSON.stringify(SAFE_MCP_FAILURE) }],
    isError: true,
  });
  assert.equal(JSON.stringify(result).includes(CANARY), false);
}

function dispatchContext(overrides: Partial<McpDispatchContext> = {}): McpDispatchContext {
  return {
    router: {} as unknown as Router,
    vault: {} as unknown as Vault,
    ...overrides,
  };
}

describe('ERR-MCP-SERVER', () => {
  it('MCP-SRV-01 returns a constant safe result for an unknown raw tool name', async () => {
    assertSafeMcpFailure(
      await dispatchToolCall(`tool_${CANARY}`, {}, dispatchContext()),
    );
  });

  it('MCP-SRV-02 does not disclose a denied raw dynamic tool name', async () => {
    const enforcer = { authorize: () => false } as unknown as McpDispatchContext['enforcer'];

    assertSafeMcpFailure(
      await dispatchToolCall(`tool_${CANARY}`, {}, dispatchContext({ enforcer })),
    );
  });

  it('MCP-SRV-03 catches vault handler failures without credential canaries', async () => {
    const vault = {
      store: () => { throw new Error(CANARY); },
    } as unknown as Vault;

    assertSafeMcpFailure(
      await dispatchToolCall('vault_store', { apiKey: CANARY }, dispatchContext({ vault })),
    );
  });

  it('MCP-SRV-04 catches LLM generation failures without provider canaries', async () => {
    const router = {
      generate: async () => { throw new Error(CANARY); },
    } as unknown as Router;

    assertSafeMcpFailure(
      await dispatchToolCall('llm_generate', { prompt: CANARY }, dispatchContext({ router })),
    );
  });

  it('MCP-SRV-05 projects a missing group store through the constant result', () => {
    assertSafeMcpFailure(handleGroupStoreTool('list_groups', {}, undefined)!);
  });

  it('MCP-SRV-06 projects a missing cost tracker through the constant result', () => {
    assertSafeMcpFailure(handleUsageTool('usage_summary', {}, undefined)!);
  });

  it('MCP-SRV-07 projects an unavailable code search service through the constant result', async () => {
    assertSafeMcpFailure((await handleCodeSearchTool('code_search', { query: CANARY }, undefined))!);
  });

  it('MCP-SRV-08 removes embedder exception canaries from vector search failures', async () => {
    const codeSearch = {
      search: async () => { throw new Error(CANARY); },
    } as unknown as CodeSearchService;

    assertSafeMcpFailure((await handleCodeSearchTool('code_search', {
      query: CANARY,
      mode: 'vector',
    }, codeSearch))!);
  });

  it('MCP-SRV-09 removes raw shared-state operation input from failures', () => {
    const stateManager = {} as unknown as StateManager;

    assertSafeMcpFailure(handleSharedStateTool('shared_state', {
      op: CANARY,
    }, stateManager)!);
  });

  it('MCP-SRV-10 projects approval and PageIndex unavailable branches safely', async () => {
    assertSafeMcpFailure(handleApprovalTool('approval_list', {}, undefined)!);
    assertSafeMcpFailure((await handlePageIndexTool('conversation_info', {}, undefined))!);
  });
});
