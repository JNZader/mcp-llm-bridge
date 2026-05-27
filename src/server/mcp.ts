/**
 * MCP Server — stdio transport with tool handlers.
 *
 * Registers LLM generation and credential management tools
 * on an MCP server using stdin/stdout transport.
 */

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
import type { CRDTType, StateSnapshot } from '../crdt/types.js';
import type { TrustLevel } from '../core/types.js';
import { CreateGroupSchema } from '../core/groups.js';
import { VERSION } from '../core/constants.js';
import { logger } from '../core/logger.js';
import { getCircuitBreakerRegistry } from '../core/circuit-breaker.js';
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

/**
 * Check if output compression is enabled for MCP tool responses.
 * Default: true.
 */
function outputCompressionEnabled(): boolean {
  return process.env['ENABLE_OUTPUT_COMPRESSION'] !== 'false';
}

/** Compression threshold in characters. Outputs exceeding this are compressed. */
const COMPRESSION_THRESHOLD = 1000;

/** Tool definitions exposed via MCP. */
export const TOOLS = [
  {
    name: 'llm_generate',
    description:
      'Generate text using an LLM. Routes to the best available provider with automatic fallback. Supports three-part prompts (system/context/instruction) for improved quality.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'The user prompt to send to the LLM (legacy flat format). Use context+instruction for better results.',
        },
        system: {
          type: 'string',
          description: 'Optional system prompt — role, personality, constraints',
        },
        context: {
          type: 'string',
          description: 'Background information, data, or documents for the task',
        },
        instruction: {
          type: 'string',
          description: 'The actual task or question to perform',
        },
        provider: {
          type: 'string',
          description: 'Preferred provider ID (e.g. "anthropic", "openai", "google", "groq", "openrouter", "claude-cli")',
        },
        model: {
          type: 'string',
          description: 'Specific model ID (e.g. "claude-sonnet-4-20250514", "gpt-4o", "gemini-2.5-flash", "llama-3.3-70b-versatile")',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum output tokens (default: 4096)',
        },
        project: {
          type: 'string',
          description: 'Project scope for credential resolution (e.g. "ghagga", "md-evals"). Falls back to global credentials if not found.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'vault_store',
    description:
      'Store an API key in the encrypted credential vault. Upserts by (provider, keyName, project).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          description: 'Provider identifier (e.g. "anthropic", "openai", "google", "groq", "openrouter")',
        },
        keyName: {
          type: 'string',
          description: 'Key slot name (default: "default")',
        },
        apiKey: {
          type: 'string',
          description: 'The API key to store',
        },
        project: {
          type: 'string',
          description: 'Project scope (default: "_global" — shared by all projects)',
        },
      },
      required: ['provider', 'apiKey'],
    },
  },
  {
    name: 'vault_list',
    description: 'List all stored credentials with masked values. Optionally filter by project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Filter by project (shows project-specific + global). Omit to show all.',
        },
      },
    },
  },
  {
    name: 'vault_delete',
    description: 'Delete a stored credential by its ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'number',
          description: 'Credential row ID to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'llm_models',
    description: 'List all available models across registered providers.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'vault_store_file',
    description:
      'Store an auth file (e.g. auth.json) in the encrypted vault. Upserts by (provider, fileName, project).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          description: 'Provider identifier (e.g. "opencode")',
        },
        fileName: {
          type: 'string',
          description: 'File name (e.g. "auth.json")',
        },
        content: {
          type: 'string',
          description: 'File content as a string',
        },
        project: {
          type: 'string',
          description: 'Project scope (default: "_global" — shared by all projects)',
        },
      },
      required: ['provider', 'fileName', 'content'],
    },
  },
  {
    name: 'vault_list_files',
    description: 'List all stored auth files (metadata only). Optionally filter by project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: {
          type: 'string',
          description: 'Filter by project (shows project-specific + global). Omit to show all.',
        },
      },
    },
  },
  {
    name: 'vault_delete_file',
    description: 'Delete a stored auth file by its ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'number',
          description: 'File row ID to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_groups',
    description: 'List all provider groups for load balancing.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'create_group',
    description: 'Create a new provider group for load balancing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Group name (e.g. "anthropic-keys", "fast-models")',
        },
        modelPattern: {
          type: 'string',
          description: 'Glob pattern to match model names (e.g. "claude-*", "gpt-*,claude-*")',
        },
        members: {
          type: 'array',
          description: 'Array of provider members: [{ provider, keyName?, weight?, priority? }]',
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              keyName: { type: 'string' },
              weight: { type: 'number' },
              priority: { type: 'number' },
            },
            required: ['provider'],
          },
        },
        strategy: {
          type: 'string',
          description: 'Balancing strategy: "round-robin", "random", "failover", "weighted"',
        },
        stickyTTL: {
          type: 'number',
          description: 'Session stickiness TTL in seconds (optional)',
        },
      },
      required: ['name', 'members', 'strategy'],
    },
  },
  {
    name: 'delete_group',
    description: 'Delete a provider group by its ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Group ID to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'configure_circuit_breaker',
    description:
      'Configure circuit breaker settings. Updates thresholds and backoff for all breakers.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        failureThreshold: {
          type: 'number',
          description: 'Number of failures before opening (default: 5)',
        },
        backoffBaseMs: {
          type: 'number',
          description: 'Exponential backoff base in ms (default: 5000). Set to enable backoff.',
        },
        backoffMultiplier: {
          type: 'number',
          description: 'Exponential backoff multiplier (default: 2)',
        },
        backoffMaxMs: {
          type: 'number',
          description: 'Maximum backoff cap in ms (default: 300000 = 5 min)',
        },
        resetTimeoutMs: {
          type: 'number',
          description: 'Fixed timeout before half-open in ms (default: 30000)',
        },
      },
    },
  },
  {
    name: 'circuit_breaker_stats',
    description:
      'Get circuit breaker stats for all providers. Shows state, failures, successes, cooldown.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'usage_summary',
    description:
      'Get cost/usage summary. Returns total requests, tokens, cost, with optional breakdown by provider, model, project, hour, or day.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          description: 'Filter by provider',
        },
        model: {
          type: 'string',
          description: 'Filter by model',
        },
        project: {
          type: 'string',
          description: 'Filter by project',
        },
        from: {
          type: 'string',
          description: 'Start date (ISO format, e.g. "2026-03-01")',
        },
        to: {
          type: 'string',
          description: 'End date (ISO format, e.g. "2026-03-23")',
        },
        groupBy: {
          type: 'string',
          description: 'Group breakdown by: "provider", "model", "project", "hour", "day"',
        },
      },
    },
  },
  {
    name: 'usage_query',
    description:
      'Query individual usage records with filters. Returns raw usage log entries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: {
          type: 'string',
          description: 'Filter by provider',
        },
        model: {
          type: 'string',
          description: 'Filter by model',
        },
        project: {
          type: 'string',
          description: 'Filter by project',
        },
        from: {
          type: 'string',
          description: 'Start date (ISO format)',
        },
        to: {
          type: 'string',
          description: 'End date (ISO format)',
        },
        limit: {
          type: 'number',
          description: 'Maximum records to return (default: 100)',
        },
      },
    },
  },
  {
    name: 'code_search',
    description:
      'Search code semantically. Finds functions, classes, and blocks matching a query using keyword + fuzzy matching. Optionally follows imports for related code.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g. "authentication middleware", "database connection")',
        },
        scope: {
          type: 'string',
          description: 'Directory path to limit search scope (default: current working directory)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10, max: 50)',
        },
        followImports: {
          type: 'boolean',
          description: 'Follow imports to find related code chunks (default: false)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'index_codebase',
    description:
      'Index a codebase directory for semantic code search. Scans files, extracts functions/classes/blocks, and builds an in-memory search index.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rootDir: {
          type: 'string',
          description: 'Root directory to index (default: current working directory)',
        },
        extensions: {
          type: 'array',
          description: 'File extensions to index (default: .ts, .js, .py, .go, .rs, etc.)',
          items: { type: 'string' },
        },
        ignorePatterns: {
          type: 'array',
          description: 'Directory names to ignore (default: node_modules, .git, dist, etc.)',
          items: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'shared_state',
    description:
      'CRDT-based shared state for multi-agent collaboration. Supports conflict-free read/write/merge with G-Counter (token tracking), LWW-Register (agent status), and OR-Set (shared findings).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        op: {
          type: 'string',
          description: 'Operation: "read", "write", "merge", "snapshot", or "list"',
        },
        key: {
          type: 'string',
          description: 'Container key name (required for read/write)',
        },
        type: {
          type: 'string',
          description: 'CRDT type: "g-counter", "lww-register", or "or-set" (required for write)',
        },
        nodeId: {
          type: 'string',
          description: 'Agent/node identifier (required for write)',
        },
        value: {
          description: 'Value to write (semantics depend on type)',
        },
        amount: {
          type: 'number',
          description: 'Increment amount for g-counter (default: 1)',
        },
        element: {
          type: 'string',
          description: 'Element to add/remove for or-set',
        },
        action: {
          type: 'string',
          description: 'Action for or-set: "add" or "remove"',
        },
        snapshot: {
          type: 'object',
          description: 'State snapshot to merge (required for merge op)',
        },
      },
      required: ['op'],
    },
  },
  {
    name: 'approval_list',
    description: 'List pending approval requests.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'approval_approve',
    description: 'Approve a pending request by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Approval request ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'approval_deny',
    description: 'Deny a pending request by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Approval request ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'local_llm_generate',
    description:
      'Generate text using a local LLM (Ollama/LM Studio) for offloadable tasks. Falls back to cloud provider if local LLM is unavailable.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'The user prompt to send to the local LLM',
        },
        system: {
          type: 'string',
          description: 'Optional system prompt',
        },
        preferredModel: {
          type: 'string',
          description: 'Preferred local model ID (e.g., "llama3.2:3b")',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum output tokens (default: 4096)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'discover_models',
    description:
      'Discover local LLM models and enrich them with HuggingFace metadata. Returns enriched model list with capabilities and recommended tasks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hfToken: {
          type: 'string',
          description: 'Optional HuggingFace API token for gated model access',
        },
      },
    },
  },
] as const;

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
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    // ── Approval flow gate for destructive tools ────────────
    if (approvalStore && securityProfile && securityProfile !== 'local-dev') {
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
        const id = vault.store(
          args['provider'] as string,
          (args['keyName'] as string | undefined) ?? 'default',
          args['apiKey'] as string,
          args['project'] as string | undefined,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id,
                provider: args['provider'],
                keyName: (args['keyName'] as string | undefined) ?? 'default',
                project: (args['project'] as string | undefined) ?? '_global',
              }),
            },
          ],
        };
      }

      case 'vault_list': {
        const credentials = vault.listMasked(
          args['project'] as string | undefined,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(credentials) }],
        };
      }

      case 'vault_delete': {
        vault.delete(args['id'] as number);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
        };
      }

      case 'llm_models': {
        const models = await router.getAvailableModels();
        return {
          content: [{ type: 'text', text: JSON.stringify(models) }],
        };
      }

      case 'vault_store_file': {
        const id = vault.storeFile(
          args['provider'] as string,
          args['fileName'] as string,
          args['content'] as string,
          args['project'] as string | undefined,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id,
                provider: args['provider'],
                fileName: args['fileName'],
                project: (args['project'] as string | undefined) ?? '_global',
              }),
            },
          ],
        };
      }

      case 'vault_list_files': {
        const files = vault.listFiles(
          args['project'] as string | undefined,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(files) }],
        };
      }

      case 'vault_delete_file': {
        vault.deleteFile(args['id'] as number);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
        };
      }

      case 'list_groups': {
        if (!groupStore) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Group store not configured' }) }],
            isError: true,
          };
        }
        const groups = groupStore.list();
        return {
          content: [{ type: 'text', text: JSON.stringify(groups) }],
        };
      }

      case 'create_group': {
        if (!groupStore) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Group store not configured' }) }],
            isError: true,
          };
        }
        const validated = CreateGroupSchema.parse(args);
        const group = groupStore.create(validated);
        return {
          content: [{ type: 'text', text: JSON.stringify(group) }],
        };
      }

      case 'delete_group': {
        if (!groupStore) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Group store not configured' }) }],
            isError: true,
          };
        }
        const deleted = groupStore.delete(args['id'] as string);
        if (!deleted) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Group not found: ${args['id']}` }) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
        };
      }

      case 'configure_circuit_breaker': {
        const cbRegistry = getCircuitBreakerRegistry();
        const update: Record<string, unknown> = {};
        if (typeof args['failureThreshold'] === 'number') update['failureThreshold'] = args['failureThreshold'];
        if (typeof args['backoffBaseMs'] === 'number') update['backoffBaseMs'] = args['backoffBaseMs'];
        if (typeof args['backoffMultiplier'] === 'number') update['backoffMultiplier'] = args['backoffMultiplier'];
        if (typeof args['backoffMaxMs'] === 'number') update['backoffMaxMs'] = args['backoffMaxMs'];
        if (typeof args['resetTimeoutMs'] === 'number') update['resetTimeoutMs'] = args['resetTimeoutMs'];

        cbRegistry.updateDefaultConfig(update as Record<string, number>);
        const newConfig = cbRegistry.getDefaultConfig();
        return {
          content: [{ type: 'text', text: JSON.stringify({ updated: true, config: newConfig }) }],
        };
      }

      case 'circuit_breaker_stats': {
        const cbRegistry = getCircuitBreakerRegistry();
        const stats = cbRegistry.getAllStats();
        return {
          content: [{ type: 'text', text: JSON.stringify({ enabled: cbRegistry.isEnabled(), breakers: stats }) }],
        };
      }

      case 'usage_summary': {
        if (!costTracker) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Cost tracker not configured' }) }],
            isError: true,
          };
        }
        const summary = costTracker.summary({
          provider: args['provider'] as string | undefined,
          model: args['model'] as string | undefined,
          project: args['project'] as string | undefined,
          from: args['from'] as string | undefined,
          to: args['to'] as string | undefined,
          groupBy: args['groupBy'] as 'provider' | 'model' | 'project' | 'hour' | 'day' | undefined,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(summary) }],
        };
      }

      case 'usage_query': {
        if (!costTracker) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Cost tracker not configured' }) }],
            isError: true,
          };
        }
        const records = costTracker.query({
          provider: args['provider'] as string | undefined,
          model: args['model'] as string | undefined,
          project: args['project'] as string | undefined,
          from: args['from'] as string | undefined,
          to: args['to'] as string | undefined,
          limit: (args['limit'] as number | undefined) ?? 100,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ records, count: records.length }) }],
        };
      }

      case 'code_search': {
        if (!codeSearch) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Code search not configured' }) }],
            isError: true,
          };
        }
        const searchQuery = args['query'] as string;
        if (!searchQuery?.trim()) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Query is required and must not be empty' }) }],
            isError: true,
          };
        }
        const results = codeSearch.search({
          query: searchQuery,
          scope: (args['scope'] as string | undefined) ?? process.cwd(),
          limit: args['limit'] as number | undefined,
          followImports: args['followImports'] as boolean | undefined,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ results, count: results.length }) }],
        };
      }

      case 'index_codebase': {
        if (!codeSearch) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Code search not configured' }) }],
            isError: true,
          };
        }
        const rootDir = (args['rootDir'] as string | undefined) ?? process.cwd();
        const chunks = codeSearch.reindex(rootDir);
        return {
          content: [{ type: 'text', text: JSON.stringify({ indexed: true, rootDir, chunks }) }],
        };
      }

      case 'shared_state': {
        if (!stateManager) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'State manager not configured' }) }],
            isError: true,
          };
        }
        const op = args['op'] as string;

        switch (op) {
          case 'read': {
            const readKey = args['key'] as string;
            if (!readKey) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'key is required for read' }) }],
                isError: true,
              };
            }
            const result = stateManager.read(readKey);
            return {
              content: [{ type: 'text', text: JSON.stringify(result ?? { error: `Key not found: ${readKey}` }) }],
              isError: !result,
            };
          }

          case 'write': {
            const writeKey = args['key'] as string;
            const crdtType = args['type'] as CRDTType;
            const writeNodeId = args['nodeId'] as string;
            if (!writeKey || !crdtType || !writeNodeId) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'key, type, and nodeId are required for write' }) }],
                isError: true,
              };
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
                return {
                  content: [{ type: 'text', text: JSON.stringify({ error: 'element is required for or-set write' }) }],
                  isError: true,
                };
              }
              stateManager.write(writeKey, 'or-set', {
                action: setAction,
                element,
                nodeId: writeNodeId,
              });
            } else {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: `Unknown CRDT type: ${crdtType as string}` }) }],
                isError: true,
              };
            }

            const written = stateManager.read(writeKey);
            return {
              content: [{ type: 'text', text: JSON.stringify({ ok: true, key: writeKey, ...written }) }],
            };
          }

          case 'merge': {
            const incoming = args['snapshot'] as StateSnapshot | undefined;
            if (!incoming) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: 'snapshot is required for merge' }) }],
                isError: true,
              };
            }
            stateManager.mergeSnapshot(incoming);
            return {
              content: [{ type: 'text', text: JSON.stringify({ ok: true, merged: Object.keys(incoming.entries).length }) }],
            };
          }

          case 'snapshot': {
            const snap = stateManager.snapshot();
            return {
              content: [{ type: 'text', text: JSON.stringify(snap) }],
            };
          }

          case 'list': {
            const containers = stateManager.list();
            return {
              content: [{ type: 'text', text: JSON.stringify({ containers }) }],
            };
          }

          default:
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: `Unknown operation: ${op}` }) }],
              isError: true,
            };
        }
      }

      case 'approval_list': {
        if (!approvalStore) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Approval store not configured' }) }],
            isError: true,
          };
        }
        const pending = approvalStore.getPending();
        return {
          content: [{ type: 'text', text: JSON.stringify({ requests: pending, count: pending.length }) }],
        };
      }

      case 'approval_approve': {
        if (!approvalStore) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Approval store not configured' }) }],
            isError: true,
          };
        }
        const id = args['id'] as string;
        const resolvedBy = args['resolvedBy'] as string | undefined ?? 'mcp-client';
        const updated = approvalStore.approve(id, resolvedBy);
        if (!updated) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Approval request not found or already resolved' }) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(updated) }],
        };
      }

      case 'approval_deny': {
        if (!approvalStore) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Approval store not configured' }) }],
            isError: true,
          };
        }
        const id = args['id'] as string;
        const resolvedBy = args['resolvedBy'] as string | undefined ?? 'mcp-client';
        const updated = approvalStore.deny(id, resolvedBy);
        if (!updated) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Approval request not found or already resolved' }) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(updated) }],
        };
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

      default:
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) },
          ],
          isError: true,
        };
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
  );
  return compressToolResult(result);
}

/**
 * Start the MCP server with stdio transport.
 *
 * Registers all LLM and vault tools, connecting them to the shared
 * Router and Vault instances.
 */
export async function startMcpServer(router: Router, vault: Vault, groupStore?: GroupStore, costTracker?: CostTracker, bridge?: BridgeOrchestrator | null, codeSearch?: CodeSearchService | null, stateManager?: StateManager | null, securityProfile?: TrustLevel, approvalStore?: ApprovalStore): Promise<Server> {
  const server = new Server(
    {
      name: 'mcp-llm-bridge',
      version: VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  );

  // Default handlers (no security filtering)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOLS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, (args ?? {}) as Record<string, unknown>, router, vault, groupStore, costTracker, bridge, codeSearch, stateManager, approvalStore, securityProfile);
  });

  // Apply security profile enforcement — overwrites handlers above with
  // filtered ListTools and authorized + rate-limited CallTool.
  let enforcer: ProfileEnforcer | undefined;
  const profileName = securityProfile ?? 'local-dev';

  if (profileName !== 'local-dev') {
    enforcer = new ProfileEnforcer(profileName);
    enforcer.wrapHandlers(
      server,
      TOOLS,
      (name, args) =>
        handleToolCall(name, args, router, vault, groupStore, costTracker, bridge, codeSearch, stateManager, approvalStore, securityProfile),
    );
  }

  // Initialize PageIndex for conversation pagination
  // Prevents compaction loops with small context models (4K-8K)
  const { wrapWithPageIndex } = await import('../pageindex/mcp-integration.js');
  wrapWithPageIndex(server, vault?.getDb?.());

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info({ securityProfile: profileName }, 'MCP server started on stdio');

  return server;
}
