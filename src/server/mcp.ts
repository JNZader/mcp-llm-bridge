/**
 * MCP Server — stdio transport with tool handlers.
 *
 * Registers LLM generation and credential management tools
 * on an MCP server using stdin/stdout transport.
 */

import type { Router } from '../core/router.js';
import type { Vault } from '../vault/vault.js';
import type { GroupStore } from '../core/groups.js';
import type { CostTracker } from '../core/cost-tracker.js';
import type { BridgeOrchestrator } from '../bridge/orchestrator.js';
import type { CodeSearchService } from '../code-search/index.js';
import type { StateManager } from '../crdt/index.js';
import type { TrustLevel } from '../core/types.js';
import { ProfileEnforcer } from '../security/enforcer.js';
import type { ApprovalStore } from '../approval/index.js';
import { compressOutput, compressionStats } from '../context-compression/output-compression.js';
import { outputCompressionEnabled } from '../core/runtime-flags.js';
import { PageIndexTools } from '../pageindex/tools.js';
import { TOOLS } from './mcp-tool-registry.js';
import {
  dynamicToolAdapter,
  getDynamicPluginLoadSummary,
  getRuntimeMcpTools,
  type StartMcpServerOptions,
  startMcpServer as startMcpServerBootstrap,
} from './mcp-server.js';
import { dispatchToolCall } from './mcp-dispatcher.js';

/** Compression threshold in characters. Outputs exceeding this are compressed. */
const COMPRESSION_THRESHOLD = 1000;

export { TOOLS, dynamicToolAdapter, getDynamicPluginLoadSummary, getRuntimeMcpTools };

export type StartMcpServerDeps = Omit<StartMcpServerOptions, 'handleToolCall'>;

function isStartMcpServerDeps(
  value: Router | StartMcpServerDeps,
): value is StartMcpServerDeps {
  return typeof value === 'object' && value !== null && 'router' in value && 'vault' in value;
}

/**
 * Handle a tool call by dispatching to the appropriate router/vault method.
 * Exported for testing.
 */
/**
 * Apply RTK-style output compression to a tool result when enabled.
 */
function compressToolResult(
  result: { content: Array<{ type: 'text'; text: string }>; isError?: boolean },
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  if (!outputCompressionEnabled() || !result.content || result.content.length === 0) {
    return result;
  }

  const first = result.content[0];
  if (!first || first.type !== 'text') return result;

  if (first.text.length > COMPRESSION_THRESHOLD) {
    const compressed = compressOutput(first.text) as string;
    compressionStats.record(first.text, compressed);
    return {
      ...result,
      content: [{ ...first, text: compressed }, ...result.content.slice(1)],
    };
  }

  return result;
}

/**
 * Exported handleToolCall — wraps the internal handler with output compression.
 */
export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  router: Router,
  vault: Vault,
  groupStore?: GroupStore,
  costTracker?: CostTracker,
  bridge?: BridgeOrchestrator | null,
  codeSearch?: CodeSearchService | null,
  stateManager?: StateManager | null,
  approvalStore?: ApprovalStore | null,
  securityProfile?: TrustLevel,
  enforcer?: ProfileEnforcer,
  pageIndexTools?: PageIndexTools,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const result = await dispatchToolCall(toolName, args, {
    router,
    vault,
    groupStore,
    costTracker,
    bridge,
    codeSearch,
    stateManager,
    approvalStore,
    securityProfile,
    enforcer,
    pageIndexTools,
  });
  return compressToolResult(result);
}

/**
 * Start the MCP server with stdio transport.
 *
 * Registers all LLM and vault tools, connecting them to the shared
 * Router and Vault instances.
 */
export async function startMcpServer(deps: StartMcpServerDeps): ReturnType<typeof startMcpServerBootstrap>;
/**
 * @deprecated Pass a single options object instead: `startMcpServer({ router, vault, ... })`.
 */
export async function startMcpServer(router: Router, vault: Vault, groupStore?: GroupStore, costTracker?: CostTracker, bridge?: BridgeOrchestrator | null, codeSearch?: CodeSearchService | null, stateManager?: StateManager | null, securityProfile?: TrustLevel, approvalStore?: ApprovalStore, pageIndexTools?: PageIndexTools): ReturnType<typeof startMcpServerBootstrap>;
export async function startMcpServer(
  routerOrDeps: Router | StartMcpServerDeps,
  vault?: Vault,
  groupStore?: GroupStore,
  costTracker?: CostTracker,
  bridge?: BridgeOrchestrator | null,
  codeSearch?: CodeSearchService | null,
  stateManager?: StateManager | null,
  securityProfile?: TrustLevel,
  approvalStore?: ApprovalStore,
  pageIndexTools?: PageIndexTools,
) {
  let options: StartMcpServerDeps;

  if (isStartMcpServerDeps(routerOrDeps)) {
    options = routerOrDeps;
  } else {
    if (!vault) {
      throw new TypeError('startMcpServer(router, vault, ...) requires a vault instance; use startMcpServer({ router, vault, ... }) instead.');
    }

    options = {
      router: routerOrDeps,
      vault,
      groupStore,
      costTracker,
      bridge,
      codeSearch,
      stateManager,
      securityProfile,
      approvalStore,
      pageIndexTools,
    };
  }

  return startMcpServerBootstrap({
    ...options,
    handleToolCall,
  });
}
