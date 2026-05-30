import type { Vault } from '../vault/vault.js';
import type { GroupStore } from '../core/groups.js';
import type { CostTracker } from '../core/cost-tracker.js';
import type { CodeSearchService } from '../code-search/index.js';
import type { StateManager } from '../crdt/index.js';
import type { CRDTType, StateSnapshot } from '../crdt/types.js';
import type { ApprovalStore } from '../approval/index.js';
import { CreateGroupSchema } from '../core/groups.js';
import {
  type LegacyCircuitBreakerConfigView,
  getCircuitBreakerAdminConfig,
  getCircuitBreakerAdminStats,
  updateCircuitBreakerAdminConfig,
} from '../circuit-breaker/admin-compat.js';
import { PageIndexTools } from '../pageindex/tools.js';

export interface McpToolTextContent {
  type: 'text';
  text: string;
}

export interface McpToolResult {
  content: McpToolTextContent[];
  isError?: boolean;
}

function jsonResult(payload: unknown, isError?: boolean): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function handleVaultTool(
  toolName: string,
  args: Record<string, unknown>,
  vault: Vault,
): McpToolResult | null {
  switch (toolName) {
    case 'vault_store': {
      const id = vault.store(
        args['provider'] as string,
        (args['keyName'] as string | undefined) ?? 'default',
        args['apiKey'] as string,
        args['project'] as string | undefined,
      );
      return jsonResult({
        id,
        provider: args['provider'],
        keyName: (args['keyName'] as string | undefined) ?? 'default',
        project: (args['project'] as string | undefined) ?? '_global',
      });
    }

    case 'vault_list':
      return jsonResult(vault.listMasked(args['project'] as string | undefined));

    case 'vault_delete': {
      vault.delete(args['id'] as number);
      return jsonResult({ ok: true });
    }

    case 'vault_store_file': {
      const id = vault.storeFile(
        args['provider'] as string,
        args['fileName'] as string,
        args['content'] as string,
        args['project'] as string | undefined,
      );
      return jsonResult({
        id,
        provider: args['provider'],
        fileName: args['fileName'],
        project: (args['project'] as string | undefined) ?? '_global',
      });
    }

    case 'vault_list_files':
      return jsonResult(vault.listFiles(args['project'] as string | undefined));

    case 'vault_delete_file': {
      vault.deleteFile(args['id'] as number);
      return jsonResult({ ok: true });
    }

    default:
      return null;
  }
}

export function handleGroupStoreTool(
  toolName: string,
  args: Record<string, unknown>,
  groupStore?: GroupStore,
): McpToolResult | null {
  switch (toolName) {
    case 'list_groups': {
      if (!groupStore) {
        return jsonResult({ error: 'Group store not configured' }, true);
      }
      return jsonResult(groupStore.list());
    }

    case 'create_group': {
      if (!groupStore) {
        return jsonResult({ error: 'Group store not configured' }, true);
      }
      const validated = CreateGroupSchema.parse(args);
      return jsonResult(groupStore.create(validated));
    }

    case 'delete_group': {
      if (!groupStore) {
        return jsonResult({ error: 'Group store not configured' }, true);
      }
      const deleted = groupStore.delete(args['id'] as string);
      if (!deleted) {
        return jsonResult({ error: `Group not found: ${args['id']}` }, true);
      }
      return jsonResult({ ok: true });
    }

    default:
      return null;
  }
}

export function handleCircuitBreakerTool(
  toolName: string,
  args: Record<string, unknown>,
): McpToolResult | null {
  switch (toolName) {
    case 'configure_circuit_breaker': {
      const update: Partial<LegacyCircuitBreakerConfigView> = {};
      if (typeof args['failureThreshold'] === 'number') update['failureThreshold'] = args['failureThreshold'];
      if (typeof args['backoffBaseMs'] === 'number') update['backoffBaseMs'] = args['backoffBaseMs'];
      if (typeof args['backoffMultiplier'] === 'number') update['backoffMultiplier'] = args['backoffMultiplier'];
      if (typeof args['backoffMaxMs'] === 'number') update['backoffMaxMs'] = args['backoffMaxMs'];
      if (typeof args['resetTimeoutMs'] === 'number') update['resetTimeoutMs'] = args['resetTimeoutMs'];

      const config = updateCircuitBreakerAdminConfig(update);
      return jsonResult({
        updated: true,
        config: {
          failureThreshold: config.failureThreshold,
          backoffBaseMs: config.backoffBaseMs,
          backoffMultiplier: config.backoffMultiplier,
          backoffMaxMs: config.backoffMaxMs,
          resetTimeoutMs: config.resetTimeoutMs,
          halfOpenSuccessThreshold: config.halfOpenSuccessThreshold,
        },
      });
    }

    case 'circuit_breaker_stats':
      return jsonResult({ enabled: getCircuitBreakerAdminConfig().enabled, breakers: getCircuitBreakerAdminStats() });

    default:
      return null;
  }
}

export function handleUsageTool(
  toolName: string,
  args: Record<string, unknown>,
  costTracker?: CostTracker,
): McpToolResult | null {
  switch (toolName) {
    case 'usage_summary': {
      if (!costTracker) {
        return jsonResult({ error: 'Cost tracker not configured' }, true);
      }
      const summary = costTracker.summary({
        provider: args['provider'] as string | undefined,
        model: args['model'] as string | undefined,
        project: args['project'] as string | undefined,
        from: args['from'] as string | undefined,
        to: args['to'] as string | undefined,
        groupBy: args['groupBy'] as 'provider' | 'model' | 'project' | 'hour' | 'day' | undefined,
      });
      return jsonResult(summary);
    }

    case 'usage_query': {
      if (!costTracker) {
        return jsonResult({ error: 'Cost tracker not configured' }, true);
      }
      const records = costTracker.query({
        provider: args['provider'] as string | undefined,
        model: args['model'] as string | undefined,
        project: args['project'] as string | undefined,
        from: args['from'] as string | undefined,
        to: args['to'] as string | undefined,
        limit: (args['limit'] as number | undefined) ?? 100,
      });
      return jsonResult({ records, count: records.length });
    }

    default:
      return null;
  }
}

export async function handleCodeSearchTool(
  toolName: string,
  args: Record<string, unknown>,
  codeSearch?: CodeSearchService | null,
): Promise<McpToolResult | null> {
  switch (toolName) {
    case 'code_search': {
      if (!codeSearch) {
        return jsonResult({ error: 'Code search not configured' }, true);
      }
      const searchQuery = args['query'] as string;
      if (!searchQuery?.trim()) {
        return jsonResult({ error: 'Query is required and must not be empty' }, true);
      }
      const mode = (args['mode'] as 'keyword' | 'vector' | 'hybrid' | undefined) ?? 'keyword';
      try {
        const results = await codeSearch.search({
          query: searchQuery,
          scope: (args['scope'] as string | undefined) ?? process.cwd(),
          limit: args['limit'] as number | undefined,
          followImports: args['followImports'] as boolean | undefined,
          mode,
        });
        return jsonResult({ results, count: results.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (mode === 'vector' || mode === 'hybrid') {
          return jsonResult({ error: `Embedder failed in ${mode} mode: ${message}`, results: [] }, true);
        }
        throw error;
      }
    }

    case 'index_codebase': {
      if (!codeSearch) {
        return jsonResult({ error: 'Code search not configured' }, true);
      }
      const rootDir = (args['rootDir'] as string | undefined) ?? process.cwd();
      const chunks = await codeSearch.reindex(rootDir);
      return jsonResult({ indexed: true, rootDir, chunks });
    }

    default:
      return null;
  }
}

export function handleSharedStateTool(
  toolName: string,
  args: Record<string, unknown>,
  stateManager?: StateManager | null,
): McpToolResult | null {
  if (toolName !== 'shared_state') {
    return null;
  }

  if (!stateManager) {
    return jsonResult({ error: 'State manager not configured' }, true);
  }

  const op = args['op'] as string;

  switch (op) {
    case 'read': {
      const readKey = args['key'] as string;
      if (!readKey) {
        return jsonResult({ error: 'key is required for read' }, true);
      }
      const result = stateManager.read(readKey);
      return jsonResult(result ?? { error: `Key not found: ${readKey}` }, !result);
    }

    case 'write': {
      const writeKey = args['key'] as string;
      const crdtType = args['type'] as CRDTType;
      const writeNodeId = args['nodeId'] as string;
      if (!writeKey || !crdtType || !writeNodeId) {
        return jsonResult({ error: 'key, type, and nodeId are required for write' }, true);
      }

      if (crdtType === 'g-counter') {
        stateManager.write(writeKey, 'g-counter', {
          nodeId: writeNodeId,
          amount: (args['amount'] as number | undefined) ?? 1,
        });
      } else if (crdtType === 'lww-register') {
        stateManager.write(writeKey, 'lww-register', {
          value: args['value'],
          nodeId: writeNodeId,
          timestamp: args['timestamp'] as number | undefined,
        });
      } else if (crdtType === 'or-set') {
        const setAction = (args['action'] as 'add' | 'remove') ?? 'add';
        const element = args['element'] as string;
        if (!element) {
          return jsonResult({ error: 'element is required for or-set write' }, true);
        }
        stateManager.write(writeKey, 'or-set', {
          action: setAction,
          element,
          nodeId: writeNodeId,
        });
      } else {
        return jsonResult({ error: `Unknown CRDT type: ${crdtType as string}` }, true);
      }

      const written = stateManager.read(writeKey);
      return jsonResult({ ok: true, key: writeKey, ...written });
    }

    case 'merge': {
      const incoming = args['snapshot'] as StateSnapshot | undefined;
      if (!incoming) {
        return jsonResult({ error: 'snapshot is required for merge' }, true);
      }
      stateManager.mergeSnapshot(incoming);
      return jsonResult({ ok: true, merged: Object.keys(incoming.entries).length });
    }

    case 'snapshot':
      return jsonResult(stateManager.snapshot());

    case 'list':
      return jsonResult({ containers: stateManager.list() });

    default:
      return jsonResult({ error: `Unknown operation: ${op}` }, true);
  }
}

export function handleApprovalTool(
  toolName: string,
  args: Record<string, unknown>,
  approvalStore?: ApprovalStore | null,
): McpToolResult | null {
  switch (toolName) {
    case 'approval_list': {
      if (!approvalStore) {
        return jsonResult({ error: 'Approval store not configured' }, true);
      }
      const pending = approvalStore.getPending();
      return jsonResult({ requests: pending, count: pending.length });
    }

    case 'approval_approve': {
      if (!approvalStore) {
        return jsonResult({ error: 'Approval store not configured' }, true);
      }
      const id = args['id'] as string;
      const resolvedBy = (args['resolvedBy'] as string | undefined) ?? 'mcp-client';
      const updated = approvalStore.approve(id, resolvedBy);
      if (!updated) {
        return jsonResult({ error: 'Approval request not found or already resolved' }, true);
      }
      return jsonResult(updated);
    }

    case 'approval_deny': {
      if (!approvalStore) {
        return jsonResult({ error: 'Approval store not configured' }, true);
      }
      const id = args['id'] as string;
      const resolvedBy = (args['resolvedBy'] as string | undefined) ?? 'mcp-client';
      const updated = approvalStore.deny(id, resolvedBy);
      if (!updated) {
        return jsonResult({ error: 'Approval request not found or already resolved' }, true);
      }
      return jsonResult(updated);
    }

    default:
      return null;
  }
}

export async function handlePageIndexTool(
  toolName: string,
  args: Record<string, unknown>,
  pageIndexTools?: PageIndexTools,
): Promise<McpToolResult | null> {
  switch (toolName) {
    case 'conversation_paginate':
    case 'conversation_get_page':
    case 'conversation_context':
    case 'conversation_navigate':
    case 'conversation_info':
    case 'conversation_find_relevant':
    case 'conversation_check_compaction': {
      if (!pageIndexTools) {
        return jsonResult({ error: 'PageIndex not available' }, true);
      }
      const result = await pageIndexTools.handleToolCall(toolName, args);
      return jsonResult(result, !result.success);
    }

    default:
      return null;
  }
}
