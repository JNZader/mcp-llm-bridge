import type { Router } from '../core/router.js';
import type { Vault } from '../vault/vault.js';
import type { GroupStore } from '../core/groups.js';
import type { CostTracker } from '../core/cost-tracker.js';
import type { BridgeOrchestrator } from '../bridge/orchestrator.js';
import type { CodeSearchService } from '../code-search/index.js';
import type { StateManager } from '../crdt/index.js';
import type { TrustLevel } from '../core/types.js';
import { ProfileEnforcer } from '../security/enforcer.js';
import { TOOL_CATEGORIES } from '../security/profiles.js';
import type { ApprovalStore } from '../approval/index.js';
import { requiresApproval, DEFAULT_CONFIG as APPROVAL_DEFAULT_CONFIG } from '../approval/index.js';
import { approvalFlowsEnabled } from '../core/runtime-flags.js';
import { PageIndexTools } from '../pageindex/tools.js';
import {
  handleDiscoverModelsTool,
  handleLlmGenerateTool,
  handleLocalLlmGenerateTool,
} from './mcp-llm-handlers.js';
import {
  handleApprovalTool,
  handleCircuitBreakerTool,
  handleCodeSearchTool,
  handleGroupStoreTool,
  handlePageIndexTool,
  handleSharedStateTool,
  handleUsageTool,
  handleVaultTool,
  type McpToolResult,
} from './mcp-tool-handlers.js';
import { dynamicToolAdapter } from './mcp-server.js';

export interface McpDispatchContext {
  router: Router;
  vault: Vault;
  groupStore?: GroupStore;
  costTracker?: CostTracker;
  bridge?: BridgeOrchestrator | null;
  codeSearch?: CodeSearchService | null;
  stateManager?: StateManager | null;
  approvalStore?: ApprovalStore | null;
  securityProfile?: TrustLevel;
  enforcer?: ProfileEnforcer;
  pageIndexTools?: PageIndexTools;
}

function approvalRequiredResult(
  toolName: string,
  args: Record<string, unknown>,
  approvalStore: ApprovalStore,
  securityProfile: TrustLevel,
): McpToolResult {
  const request = approvalStore.create({
    toolName,
    toolArgs: args,
    requester: 'mcp-client',
    reason: `Destructive tool "${toolName}" requires approval under "${securityProfile}" profile`,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        approvalRequired: true,
        requestId: request.id,
        toolName,
        reason: request.reason,
      }),
    }],
    isError: false,
  };
}

async function handleDynamicToolFallback(
  toolName: string,
  args: Record<string, unknown>,
  enforcer?: ProfileEnforcer,
): Promise<McpToolResult> {
  if (enforcer && !enforcer.authorize(toolName)) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: `Tool '${toolName}' denied by security profile` }) },
      ],
      isError: true,
    };
  }

  const dynamicTool = dynamicToolAdapter?.getTool(toolName);
  if (dynamicTool) {
    try {
      const result = await dynamicTool.handler(args);
      const content = result.content.map((item) => {
        if (item.type === 'text') return item;
        return { type: 'text' as const, text: `[image: ${item.mimeType}]` };
      });
      return {
        content,
        ...(result.isError ? { isError: true } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }

  return {
    content: [
      { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) },
    ],
    isError: true,
  };
}

export async function dispatchToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: McpDispatchContext,
): Promise<McpToolResult> {
  const {
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
  } = context;

  try {
    if (approvalFlowsEnabled() && approvalStore && securityProfile && securityProfile !== 'local-dev') {
      const category = TOOL_CATEGORIES[toolName];
      if (category === 'destructive' && requiresApproval(toolName, APPROVAL_DEFAULT_CONFIG)) {
        return approvalRequiredResult(toolName, args, approvalStore, securityProfile);
      }
    }

    switch (toolName) {
      case 'llm_generate':
        return handleLlmGenerateTool(args, router, bridge);

      case 'vault_store':
      case 'vault_list':
      case 'vault_delete':
      case 'vault_store_file':
      case 'vault_list_files':
      case 'vault_delete_file':
        return handleVaultTool(toolName, args, vault)!;

      case 'llm_models': {
        const models = await router.getAvailableModels();
        return {
          content: [{ type: 'text', text: JSON.stringify(models) }],
        };
      }

      case 'list_groups':
      case 'create_group':
      case 'delete_group':
        return handleGroupStoreTool(toolName, args, groupStore)!;

      case 'configure_circuit_breaker':
      case 'circuit_breaker_stats':
        return handleCircuitBreakerTool(toolName, args)!;

      case 'usage_summary':
      case 'usage_query':
        return handleUsageTool(toolName, args, costTracker)!;

      case 'code_search':
      case 'index_codebase':
        return (await handleCodeSearchTool(toolName, args, codeSearch))!;

      case 'shared_state':
        return handleSharedStateTool(toolName, args, stateManager)!;

      case 'approval_list':
      case 'approval_approve':
      case 'approval_deny':
        return handleApprovalTool(toolName, args, approvalStore)!;

      case 'local_llm_generate':
        return handleLocalLlmGenerateTool(args, router);

      case 'discover_models':
        return handleDiscoverModelsTool(args, vault);

      case 'conversation_paginate':
      case 'conversation_get_page':
      case 'conversation_context':
      case 'conversation_navigate':
      case 'conversation_info':
      case 'conversation_find_relevant':
      case 'conversation_check_compaction':
        return (await handlePageIndexTool(toolName, args, pageIndexTools))!;

      default:
        return handleDynamicToolFallback(toolName, args, enforcer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}
