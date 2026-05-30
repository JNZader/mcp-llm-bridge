import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { Router } from '../core/router.js';
import type { Vault } from '../vault/vault.js';
import type { GroupStore } from '../core/groups.js';
import type { CostTracker } from '../core/cost-tracker.js';
import type { BridgeOrchestrator } from '../bridge/orchestrator.js';
import type { CodeSearchService } from '../code-search/index.js';
import type { StateManager } from '../crdt/index.js';
import type { TrustLevel } from '../core/types.js';
import { VERSION } from '../core/constants.js';
import { logger } from '../core/logger.js';
import { ProfileEnforcer } from '../security/enforcer.js';
import type { ApprovalStore } from '../approval/index.js';
import { McpDefinitionAdapter } from '../mcp-builder/adapter.js';
import { loadPlugins } from '../mcp-builder/loader.js';
import { PageIndexTools } from '../pageindex/tools.js';
import { TOOLS, getRuntimeMcpTools as getRuntimeMcpToolsFromRegistry } from './mcp-tool-registry.js';

type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export interface StartMcpServerOptions {
  router: Router;
  vault: Vault;
  groupStore?: GroupStore;
  costTracker?: CostTracker;
  bridge?: BridgeOrchestrator | null;
  codeSearch?: CodeSearchService | null;
  stateManager?: StateManager | null;
  securityProfile?: TrustLevel;
  approvalStore?: ApprovalStore;
  pageIndexTools?: PageIndexTools;
  handleToolCall: (
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
  ) => Promise<ToolCallResult>;
}

/** Adapter for dynamic MCP tools loaded from plugin directory. */
export let dynamicToolAdapter: McpDefinitionAdapter | undefined;

export function getRuntimeMcpTools() {
  return getRuntimeMcpToolsFromRegistry(dynamicToolAdapter);
}

export async function startMcpServer(options: StartMcpServerOptions): Promise<Server> {
  const {
    router,
    vault,
    groupStore,
    costTracker,
    bridge,
    codeSearch,
    stateManager,
    securityProfile,
    approvalStore,
    pageIndexTools,
    handleToolCall,
  } = options;

  const server = new Server(
    {
      name: 'mcp-llm-bridge',
      version: VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  );

  let enforcer: ProfileEnforcer | undefined;

  // Default handlers (no security filtering)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getRuntimeMcpTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(
      name,
      (args ?? {}) as Record<string, unknown>,
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
    );
  });

  // Apply security profile enforcement — overwrites handlers above with
  // filtered ListTools and authorized + rate-limited CallTool.
  const profileName = securityProfile ?? 'local-dev';

  if (profileName !== 'local-dev') {
    enforcer = new ProfileEnforcer(profileName);
    enforcer.wrapHandlers(
      server,
      TOOLS,
      (name, args) =>
        handleToolCall(
          name,
          args,
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
        ),
    );
  }

  // Dynamic plugin loading
  const dynamicServersEnabled = process.env.MCP_DYNAMIC_SERVERS === 'true';
  const pluginsDir = process.env.MCP_SERVERS_DIR || './mcp-servers';

  if (dynamicServersEnabled) {
    dynamicToolAdapter = new McpDefinitionAdapter();
    loadPlugins(pluginsDir).then((plugins) => {
      for (const plugin of plugins) {
        dynamicToolAdapter!.register(server, plugin.definition);
        console.log(`[MCP] Loaded dynamic server: ${plugin.name} (${plugin.definition.tools.length} tools)`);
      }

      // Register dynamic tools with enforcer and update ListTools handler
      if (enforcer && dynamicToolAdapter) {
        for (const name of dynamicToolAdapter.getToolNames()) {
          enforcer.registerDynamicTool(name, 'read');
        }
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: enforcer.filterTools(getRuntimeMcpTools()),
        }));
      }
    }).catch((error) => {
      console.error('[MCP] Failed to load dynamic servers:', error);
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info({ securityProfile: profileName }, 'MCP server started on stdio');

  return server;
}
