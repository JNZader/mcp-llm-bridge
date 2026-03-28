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
import { CreateGroupSchema } from '../core/groups.js';
import { VERSION } from '../core/constants.js';
import { logger } from '../core/logger.js';
import { getCircuitBreakerRegistry } from '../core/circuit-breaker.js';

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
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    switch (toolName) {
      case 'llm_generate': {
        const result = await router.generate({
          prompt: args['prompt'] as string,
          system: args['system'] as string | undefined,
          provider: args['provider'] as string | undefined,
          model: args['model'] as string | undefined,
          maxTokens: args['maxTokens'] as number | undefined,
          project: args['project'] as string | undefined,
        });
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
export async function startMcpServer(router: Router, vault: Vault, groupStore?: GroupStore, costTracker?: CostTracker): Promise<Server> {
  const server = new Server(
    {
      name: 'mcp-llm-bridge',
      version: VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOLS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, (args ?? {}) as Record<string, unknown>, router, vault, groupStore, costTracker);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('MCP server started on stdio');

  return server;
}
