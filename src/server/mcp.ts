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
import { TOOL_CATEGORIES } from '../security/profiles.js';
import type { ApprovalStore } from '../approval/index.js';
import { requiresApproval, DEFAULT_CONFIG as APPROVAL_DEFAULT_CONFIG } from '../approval/index.js';
import { compressOutput, compressionStats } from '../context-compression/output-compression.js';
import { detectLocalLLMs, pickBestLocalModel } from '../local-llm/detector.js';
import { callLocalLLM, LocalLLMError } from '../local-llm/client.js';
import { classifyForOffload, meetsOffloadThreshold } from '../local-llm/router.js';
import { discoverModels } from '../model-discovery/discovery.js';
import { DEFAULT_LOCAL_LLM_CONFIG } from '../local-llm/types.js';
import { PageIndexTools } from '../pageindex/tools.js';
import { TOOLS } from './mcp-tool-registry.js';
import {
  handleApprovalTool,
  handleCircuitBreakerTool,
  handleCodeSearchTool,
  handleGroupStoreTool,
  handlePageIndexTool,
  handleSharedStateTool,
  handleUsageTool,
  handleVaultTool,
} from './mcp-tool-handlers.js';
import {
  dynamicToolAdapter,
  getRuntimeMcpTools,
  startMcpServer as startMcpServerBootstrap,
} from './mcp-server.js';

/**
 * Check if output compression is enabled for MCP tool responses.
 * Default: true.
 */
function outputCompressionEnabled(): boolean {
  return process.env['ENABLE_OUTPUT_COMPRESSION'] !== 'false';
}

/** Compression threshold in characters. Outputs exceeding this are compressed. */
const COMPRESSION_THRESHOLD = 1000;

export { TOOLS, dynamicToolAdapter, getRuntimeMcpTools };

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
 * Internal handler — contains all tool logic.
 */
async function _handleToolCall(
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
  try {
    // ── Approval flow gate for destructive tools ────────────
    const approvalFlowsEnabled = process.env['APPROVAL_FLOWS_ENABLED'] !== 'false';
    if (approvalFlowsEnabled && approvalStore && securityProfile && securityProfile !== 'local-dev') {
      const category = TOOL_CATEGORIES[toolName];
      if (category === 'destructive' && requiresApproval(toolName, APPROVAL_DEFAULT_CONFIG)) {
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
    }

    switch (toolName) {
      case 'llm_generate': {
        let prompt = args['prompt'] as string | undefined;
        const system = args['system'] as string | undefined;
        const context = args['context'] as string | undefined;
        const instruction = args['instruction'] as string | undefined;

        // Build prompt from three-part fields if provided
        if (context || instruction) {
          const parts: string[] = [];
          if (context) parts.push(`[Context]\n${context}`);
          if (instruction) parts.push(`[Instruction]\n${instruction}`);
          prompt = parts.join('\n\n') ?? prompt ?? '';
        }

        const request = {
          prompt: prompt ?? '',
          system,
          provider: args['provider'] as string | undefined,
          model: args['model'] as string | undefined,
          maxTokens: args['maxTokens'] as number | undefined,
          project: args['project'] as string | undefined,
        };

        // Use bridge orchestrator when available and no explicit provider/model requested
        if (bridge && !request.provider && !request.model) {
          const result = await bridge.generate(request);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        }

        const result = await router.generate(request);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      }

      case 'vault_store': {
        return handleVaultTool(toolName, args, vault)!;
      }

      case 'vault_list': {
        return handleVaultTool(toolName, args, vault)!;
      }

      case 'vault_delete': {
        return handleVaultTool(toolName, args, vault)!;
      }

      case 'llm_models': {
        const models = await router.getAvailableModels();
        return {
          content: [{ type: 'text', text: JSON.stringify(models) }],
        };
      }

      case 'vault_store_file': {
        return handleVaultTool(toolName, args, vault)!;
      }

      case 'vault_list_files': {
        return handleVaultTool(toolName, args, vault)!;
      }

      case 'vault_delete_file': {
        return handleVaultTool(toolName, args, vault)!;
      }

      case 'list_groups': {
        return handleGroupStoreTool(toolName, args, groupStore)!;
      }

      case 'create_group': {
        return handleGroupStoreTool(toolName, args, groupStore)!;
      }

      case 'delete_group': {
        return handleGroupStoreTool(toolName, args, groupStore)!;
      }

      case 'configure_circuit_breaker': {
        return handleCircuitBreakerTool(toolName, args)!;
      }

      case 'circuit_breaker_stats': {
        return handleCircuitBreakerTool(toolName, args)!;
      }

      case 'usage_summary': {
        return handleUsageTool(toolName, args, costTracker)!;
      }

      case 'usage_query': {
        return handleUsageTool(toolName, args, costTracker)!;
      }

      case 'code_search': {
        return (await handleCodeSearchTool(toolName, args, codeSearch))!;
      }

      case 'index_codebase': {
        return (await handleCodeSearchTool(toolName, args, codeSearch))!;
      }

      case 'shared_state': {
        return handleSharedStateTool(toolName, args, stateManager)!;
      }

      case 'approval_list': {
        return handleApprovalTool(toolName, args, approvalStore)!;
      }

      case 'approval_approve': {
        return handleApprovalTool(toolName, args, approvalStore)!;
      }

      case 'approval_deny': {
        return handleApprovalTool(toolName, args, approvalStore)!;
      }

      case 'local_llm_generate': {
        const prompt = args['prompt'] as string;
        const system = args['system'] as string | undefined;
        const preferredModel = args['preferredModel'] as string | undefined;
        const maxTokens = args['maxTokens'] as number | undefined;

        // If LOCAL_LLM_ENABLED=false or no local LLM configured, route directly to cloud
        const localEnabled = process.env['LOCAL_LLM_ENABLED'] === 'true';
        if (!localEnabled) {
          const result = await router.generate({ prompt, system, maxTokens });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ ...result, backend: 'cloud', reason: 'LOCAL_LLM_ENABLED=false' }),
            }],
          };
        }

        // Detect local models
        const detections = await detectLocalLLMs();
        const localModel = pickBestLocalModel(detections, preferredModel);

        if (!localModel) {
          // No local model available — fall back to cloud
          const result = await router.generate({ prompt, system, maxTokens });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ ...result, backend: 'cloud', reason: 'No local models available' }),
            }],
          };
        }

        // Classify for offloading
        const classification = classifyForOffload(prompt);
        const minConfidence = DEFAULT_LOCAL_LLM_CONFIG.minOffloadConfidence;
        if (!meetsOffloadThreshold(classification, minConfidence)) {
          // Task not offloadable — route to cloud
          const result = await router.generate({ prompt, system, maxTokens });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ...result,
                backend: 'cloud',
                reason: `Task not offloadable: ${classification.reason}`,
              }),
            }],
          };
        }

        // Try local LLM
        try {
          const localResult = await callLocalLLM(localModel, prompt, system);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                text: localResult.text,
                model: localResult.model,
                backend: 'local',
                provider: 'local-llm',
                resolvedProvider: 'local-llm',
                resolvedModel: localResult.model,
                fallbackUsed: false,
                latencyMs: localResult.latencyMs,
                tokensUsed: localResult.tokensUsed,
              }),
            }],
          };
        } catch (error) {
          if (error instanceof LocalLLMError) {
            // Fall back to cloud provider
            const cloudResult = await router.generate({ prompt, system, maxTokens });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  ...cloudResult,
                  backend: 'cloud',
                  fallbackUsed: true,
                  fallbackReason: `Local LLM failed: ${error.message}`,
                }),
              }],
            };
          }
          throw error;
        }
      }

      case 'discover_models': {
        const hfToken = args['hfToken'] as string | undefined;
        try {
          const result = await discoverModels(
            { hfToken: hfToken ?? process.env['HF_TOKEN'], enabled: true },
            {
              ollamaUrl: process.env['OLLAMA_URL'] ?? 'http://localhost:11434',
              lmStudioUrl: process.env['LM_STUDIO_URL'] ?? 'http://localhost:1234',
            },
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                models: result.models,
                backendsScanned: result.backendsScanned,
                enrichedCount: result.enrichedCount,
                unenrichedCount: result.unenrichedCount,
                errors: result.errors,
                timestamp: result.timestamp,
              }),
            }],
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
            isError: true,
          };
        }
      }

      case 'conversation_paginate':
      case 'conversation_get_page':
      case 'conversation_context':
      case 'conversation_navigate':
      case 'conversation_info':
      case 'conversation_find_relevant':
      case 'conversation_check_compaction': {
        return (await handlePageIndexTool(toolName, args, pageIndexTools))!;
      }

      default: {
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
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
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
  const result = await _handleToolCall(
    toolName,
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
  return compressToolResult(result);
}

/**
 * Start the MCP server with stdio transport.
 *
 * Registers all LLM and vault tools, connecting them to the shared
 * Router and Vault instances.
 */
export async function startMcpServer(router: Router, vault: Vault, groupStore?: GroupStore, costTracker?: CostTracker, bridge?: BridgeOrchestrator | null, codeSearch?: CodeSearchService | null, stateManager?: StateManager | null, securityProfile?: TrustLevel, approvalStore?: ApprovalStore, pageIndexTools?: PageIndexTools) {
  return startMcpServerBootstrap({
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
  });
}
