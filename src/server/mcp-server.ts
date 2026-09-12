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
import { assertProviderRegistryFrozen } from '../core/provider-registry.js';
import { dynamicMcpServersEnabled, mcpServersDir, pluginRuntimeConfig } from '../core/mcp-runtime-config.js';
import { logger } from '../core/logger.js';
import { ProfileEnforcer } from '../security/enforcer.js';
import type { ApprovalStore } from '../approval/index.js';
import { McpDefinitionAdapter, type DynamicToolRuntimeHealth } from '../mcp-builder/adapter.js';
import { loadPlugins, loadWorkerPlugins, type LoadedPlugin, type PluginLoadIssue } from '../mcp-builder/loader.js';
import { PageIndexTools } from '../pageindex/tools.js';
import { createPluginRuntimeRegistry, type PluginRuntimeRegistry } from '../mcp-builder/plugin-runtime-registry.js';
import { TOOLS, getRuntimeMcpTools as getRuntimeMcpToolsFromRegistry } from './mcp-tool-registry.js';
import { createDynamicPluginDiagnostics, type DynamicPluginDiagnostics } from './plugin-diagnostics.js';

type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

const SAFE_MCP_FAILURE = {
  error: 'An unexpected internal error occurred.',
  code: 'INTERNAL_ERROR',
} as const;

function safeToolCallResult(): ToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(SAFE_MCP_FAILURE) }],
    isError: true,
  };
}

function dynamicPluginOperationEvent(summary: DynamicPluginLoadSummary) {
  return {
    enabled: summary.enabled,
    loaded: summary.loaded.length,
    skipped: summary.skipped.length,
    errors: summary.errors.length,
    collisions: summary.collisions.length,
  };
}

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
  pluginRuntimeRegistry?: PluginRuntimeRegistry;
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
  runtime: DynamicPluginRuntimeHealth;
}

export interface DynamicPluginToolRuntimeHealth {
  name: string;
  status: DynamicToolRuntimeHealth['status'];
  consecutiveFailures: number;
  quarantined: boolean;
  lastErrorCode?: DynamicToolRuntimeHealth['lastErrorCode'];
  lastErrorMessage?: string;
}

export interface DynamicPluginRuntimeHealth {
  healthyToolCount: number;
  quarantinedToolCount: number;
  tools: DynamicPluginToolRuntimeHealth[];
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

type AdmittedDynamicPluginLoadedServer = Omit<DynamicPluginLoadedServer, 'runtime'>;

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

function createPluginRuntimeHealth(
  loadedServer: Omit<DynamicPluginLoadedServer, 'runtime'>,
  runtimeHealthByToolName: Map<string, DynamicToolRuntimeHealth>,
): DynamicPluginRuntimeHealth {
  const tools = loadedServer.toolNames.map((toolName) => {
    const runtime = runtimeHealthByToolName.get(toolName);
    return {
      name: toolName,
      status: runtime?.status ?? 'healthy',
      consecutiveFailures: runtime?.consecutiveFailures ?? 0,
      quarantined: runtime?.quarantined ?? false,
      lastErrorCode: runtime?.lastErrorCode,
      lastErrorMessage: runtime?.lastErrorMessage,
    };
  });

  return {
    healthyToolCount: tools.filter((tool) => !tool.quarantined).length,
    quarantinedToolCount: tools.filter((tool) => tool.quarantined).length,
    tools,
  };
}

function admitDynamicPlugins(
  server: Server,
  plugins: LoadedPlugin[],
  adapter: McpDefinitionAdapter,
  enforcer?: ProfileEnforcer,
  workerProxy: boolean = false,
): { loaded: AdmittedDynamicPluginLoadedServer[]; collisions: DynamicPluginCollision[] } {
  const builtInToolNames = new Set<string>(TOOLS.map((tool) => tool.name));
  const admittedToolOwners = new Map<string, string>();
  const loaded: AdmittedDynamicPluginLoadedServer[] = [];
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

    if (workerProxy) {
      adapter.registerWorkerProxy(server, plugin.definition, plugin.name);
    } else {
      adapter.register(server, plugin.definition, plugin.name);
    }
    for (const tool of plugin.definition.tools) {
      const toolName = tool.name;
      admittedToolOwners.set(toolName, plugin.name);
      if (enforcer && tool.security) {
        enforcer.registerDynamicTool(toolName, tool.security);
      }
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
  const runtimeHealthByToolName = new Map(
    (dynamicToolAdapter?.getRuntimeHealth() ?? []).map((tool) => [tool.name, tool]),
  );

  return {
    ...dynamicPluginLoadSummary,
    loaded: dynamicPluginLoadSummary.loaded.map(({ plugin, toolCount, toolNames }) => ({
      plugin,
      toolCount,
      toolNames,
      runtime: createPluginRuntimeHealth({ plugin, toolCount, toolNames }, runtimeHealthByToolName),
    })),
  };
}

/**
 * Returns an allowlisted aggregate diagnostics snapshot for dynamic plugins.
 * This is an in-process API and does not register an MCP tool or HTTP route.
 */
export function getDynamicPluginDiagnostics(): DynamicPluginDiagnostics {
  return createDynamicPluginDiagnostics(dynamicPluginLoadSummary);
}

export async function startMcpServer(options: StartMcpServerOptions): Promise<Server> {
  assertProviderRegistryFrozen(options.router);

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
    pluginRuntimeRegistry,
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
    try {
      return await handleToolCall(
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
    } catch {
      return safeToolCallResult();
    }
  });

  // Apply security profile enforcement — overwrites handlers above with
  // filtered ListTools and authorized + rate-limited CallTool.
  const profileName = securityProfile ?? 'local-dev';

  if (profileName !== 'local-dev') {
    enforcer = new ProfileEnforcer(profileName);
    enforcer.wrapHandlers(
      server,
      TOOLS,
      async (name, args) => {
        try {
          return await handleToolCall(
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
          );
        } catch {
          return safeToolCallResult();
        }
      },
    );
  }

  // Dynamic plugin loading
  const dynamicServersEnabled = dynamicMcpServersEnabled();
  const pluginsDir = mcpServersDir();
  dynamicPluginLoadSummary = createEmptyDynamicPluginLoadSummary(dynamicServersEnabled, pluginsDir);
  const runtimeRegistry = pluginRuntimeRegistry ?? createPluginRuntimeRegistry();

  try {
    if (dynamicServersEnabled) {
      // Worker compatibility needs byte observations, which loadWorkerPlugins
      // obtains before it asks the config reader to validate external evidence.
      const workerMode = process.env['MCP_PLUGIN_RUNTIME_MODE'] === 'worker';
      if (!workerMode) pluginRuntimeConfig();
      dynamicToolAdapter = new McpDefinitionAdapter();
      const workerLoadSummary = workerMode
        ? await loadWorkerPlugins(pluginsDir, runtimeRegistry)
        : undefined;
      const legacyLoadSummary = workerMode
        ? undefined
        : await loadPlugins(pluginsDir);
      const pluginLoadSummary = workerLoadSummary ?? legacyLoadSummary!;
      const admissionSummary = admitDynamicPlugins(
        server,
        pluginLoadSummary.loaded,
        dynamicToolAdapter,
        enforcer,
        workerMode,
      );

      dynamicPluginLoadSummary = {
        enabled: true,
        directory: pluginsDir,
        loaded: admissionSummary.loaded.map(({ plugin, toolCount, toolNames }) => ({
          plugin,
          toolCount,
          toolNames,
          runtime: createPluginRuntimeHealth(
            { plugin, toolCount, toolNames },
            new Map<string, DynamicToolRuntimeHealth>(),
          ),
        })),
        skipped: legacyLoadSummary?.skipped ?? [],
        errors: pluginLoadSummary.errors,
        collisions: admissionSummary.collisions,
      };

      if (enforcer && dynamicToolAdapter) {
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: enforcer.filterTools(getRuntimeMcpTools()),
        }));
      }

      if (
        dynamicPluginLoadSummary.skipped.length > 0
        || dynamicPluginLoadSummary.errors.length > 0
        || dynamicPluginLoadSummary.collisions.length > 0
      ) {
        logger.warn({ dynamicPluginOperation: dynamicPluginOperationEvent(dynamicPluginLoadSummary) }, 'Dynamic MCP plugin admission completed with quarantined entries');
      } else {
        logger.info({ dynamicPluginOperation: dynamicPluginOperationEvent(dynamicPluginLoadSummary) }, 'Dynamic MCP plugin admission completed');
      }
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);

    const originalClose = server.close.bind(server);
    let closePromise: Promise<void> | undefined;
    server.close = async () => {
      if (!closePromise) {
        closePromise = (async () => {
          await runtimeRegistry.closeAll();
          await originalClose();
        })();
      }
      return closePromise;
    };

    logger.info({ securityProfile: profileName }, 'MCP server started on stdio');

    return server;
  } catch (error) {
    await runtimeRegistry.closeAll().catch(() => undefined);
    throw error;
  }
}
