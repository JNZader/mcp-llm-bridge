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
import { dynamicMcpServersEnabled, mcpServersDir } from '../core/mcp-runtime-config.js';
import { logger } from '../core/logger.js';
import { ProfileEnforcer } from '../security/enforcer.js';
import type { ApprovalStore } from '../approval/index.js';
import { McpDefinitionAdapter } from '../mcp-builder/adapter.js';
import { loadPlugins, type LoadedPlugin, type PluginLoadIssue } from '../mcp-builder/loader.js';
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

const DYNAMIC_PLUGIN_COLLISION = {
  BUILT_IN: 'built-in-tool-name',
  PLUGIN: 'plugin-tool-name',
} as const;

type DynamicPluginCollisionCode = (typeof DYNAMIC_PLUGIN_COLLISION)[keyof typeof DYNAMIC_PLUGIN_COLLISION];

export interface DynamicPluginLoadedServer {
  plugin: string;
  toolCount: number;
  toolNames: string[];
}

export interface DynamicPluginCollision {
  plugin: string;
  toolName: string;
  code: DynamicPluginCollisionCode;
  existingPlugin: string;
  message: string;
}

export interface DynamicPluginLoadSummary {
  enabled: boolean;
  directory: string;
  loaded: DynamicPluginLoadedServer[];
  skipped: PluginLoadIssue[];
  errors: PluginLoadIssue[];
  collisions: DynamicPluginCollision[];
}

let dynamicPluginLoadSummary: DynamicPluginLoadSummary = {
  enabled: false,
  directory: '',
  loaded: [],
  skipped: [],
  errors: [],
  collisions: [],
};

function createEmptyDynamicPluginLoadSummary(enabled: boolean, directory: string): DynamicPluginLoadSummary {
  return {
    enabled,
    directory,
    loaded: [],
    skipped: [],
    errors: [],
    collisions: [],
  };
}

function admitDynamicPlugins(
  server: Server,
  plugins: LoadedPlugin[],
  adapter: McpDefinitionAdapter,
): Pick<DynamicPluginLoadSummary, 'loaded' | 'collisions'> {
  const builtInToolNames = new Set<string>(TOOLS.map((tool) => tool.name));
  const admittedToolOwners = new Map<string, string>();
  const loaded: DynamicPluginLoadedServer[] = [];
  const collisions: DynamicPluginCollision[] = [];

  for (const plugin of plugins) {
    const pluginToolNames = plugin.definition.tools.map((tool) => tool.name);
    const pluginCollisions: DynamicPluginCollision[] = [];
    const pluginOwnedNames = new Set<string>();

    for (const toolName of pluginToolNames) {
      if (builtInToolNames.has(toolName)) {
        pluginCollisions.push({
          plugin: plugin.name,
          toolName,
          code: DYNAMIC_PLUGIN_COLLISION.BUILT_IN,
          existingPlugin: 'built-in',
          message: `Tool "${toolName}" collides with a built-in MCP tool`,
        });
        continue;
      }

      const existingPlugin = pluginOwnedNames.has(toolName)
        ? plugin.name
        : admittedToolOwners.get(toolName);

      if (existingPlugin) {
        pluginCollisions.push({
          plugin: plugin.name,
          toolName,
          code: DYNAMIC_PLUGIN_COLLISION.PLUGIN,
          existingPlugin,
          message: `Tool "${toolName}" collides with plugin "${existingPlugin}"`,
        });
        continue;
      }

      pluginOwnedNames.add(toolName);
    }

    if (pluginCollisions.length > 0) {
      collisions.push(...pluginCollisions);
      continue;
    }

    adapter.register(server, plugin.definition, plugin.name);
    for (const toolName of pluginToolNames) {
      admittedToolOwners.set(toolName, plugin.name);
    }
    loaded.push({
      plugin: plugin.name,
      toolCount: pluginToolNames.length,
      toolNames: pluginToolNames,
    });
  }

  return { loaded, collisions };
}

export function getRuntimeMcpTools() {
  return getRuntimeMcpToolsFromRegistry(dynamicToolAdapter);
}

export function getDynamicPluginLoadSummary(): DynamicPluginLoadSummary {
  return dynamicPluginLoadSummary;
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

  // Reset dynamic runtime state on every startup to prevent cross-start leakage.
  dynamicToolAdapter = undefined;

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
  const dynamicServersEnabled = dynamicMcpServersEnabled();
  const pluginsDir = mcpServersDir();
  dynamicPluginLoadSummary = createEmptyDynamicPluginLoadSummary(dynamicServersEnabled, pluginsDir);

  if (dynamicServersEnabled) {
    dynamicToolAdapter = new McpDefinitionAdapter();
    const pluginLoadSummary = await loadPlugins(pluginsDir);
    const admissionSummary = admitDynamicPlugins(server, pluginLoadSummary.loaded, dynamicToolAdapter);

    dynamicPluginLoadSummary = {
      enabled: true,
      directory: pluginsDir,
      loaded: admissionSummary.loaded,
      skipped: pluginLoadSummary.skipped,
      errors: pluginLoadSummary.errors,
      collisions: admissionSummary.collisions,
    };

    if (enforcer && dynamicToolAdapter) {
      // Safe-by-default: dynamic tools remain unknown to restricted profiles
      // unless a future explicit categorization step is added.
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: enforcer.filterTools(getRuntimeMcpTools()),
      }));
    }

    if (
      dynamicPluginLoadSummary.skipped.length > 0
      || dynamicPluginLoadSummary.errors.length > 0
      || dynamicPluginLoadSummary.collisions.length > 0
    ) {
      logger.warn({ dynamicPluginLoadSummary }, 'Dynamic MCP plugin admission completed with quarantined entries');
    } else {
      logger.info({ dynamicPluginLoadSummary }, 'Dynamic MCP plugin admission completed');
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info({ securityProfile: profileName }, 'MCP server started on stdio');

  return server;
}
