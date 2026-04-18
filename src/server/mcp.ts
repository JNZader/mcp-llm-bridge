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
import { createPageIndex } from '../pageindex/index.js';

/** Tool definitions exposed via MCP. */
const TOOLS = [
  {
    name: 'llm_generate',
    description:
      'Generate text using an LLM. Routes to the best available provider with automatic fallback.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'The user prompt to send to the LLM',
        },
        system: {
          type: 'string',
          description: 'Optional system prompt',
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
] as const;

/**
 * Handle a tool call by dispatching to the appropriate router/vault method.
 */
async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  router: Router,
  vault: Vault,
  groupStore?: GroupStore,
  costTracker?: CostTracker,
  bridge?: BridgeOrchestrator | null,
  codeSearch?: CodeSearchService | null,
  stateManager?: StateManager | null,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      case 'llm_generate': {
        const request = {
          prompt: args['prompt'] as string,
          system: args['system'] as string | undefined,
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
 * Start the MCP server with stdio transport.
 *
 * Registers all LLM and vault tools, connecting them to the shared
 * Router and Vault instances.
 */
export async function startMcpServer(router: Router, vault: Vault, groupStore?: GroupStore, costTracker?: CostTracker, bridge?: BridgeOrchestrator | null, codeSearch?: CodeSearchService | null, stateManager?: StateManager | null, securityProfile?: TrustLevel): Promise<Server> {
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
    return handleToolCall(name, (args ?? {}) as Record<string, unknown>, router, vault, groupStore, costTracker, bridge, codeSearch, stateManager);
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
        handleToolCall(name, args, router, vault, groupStore, costTracker, bridge, codeSearch, stateManager),
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
