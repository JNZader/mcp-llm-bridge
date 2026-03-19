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
      },
      required: ['prompt'],
    },
  },
  {
    name: 'vault_store',
    description:
      'Store an API key in the encrypted credential vault. Upserts by (provider, keyName).',
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
      },
      required: ['provider', 'apiKey'],
    },
  },
  {
    name: 'vault_list',
    description: 'List all stored credentials with masked values.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
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
] as const;

/**
 * Handle a tool call by dispatching to the appropriate router/vault method.
 */
async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  router: Router,
  vault: Vault,
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
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id,
                provider: args['provider'],
                keyName: (args['keyName'] as string | undefined) ?? 'default',
              }),
            },
          ],
        };
      }

      case 'vault_list': {
        const credentials = vault.listMasked();
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
export async function startMcpServer(router: Router, vault: Vault): Promise<Server> {
  const server = new Server(
    {
      name: 'mcp-llm-bridge',
      version: '0.2.0',
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
    return handleToolCall(name, (args ?? {}) as Record<string, unknown>, router, vault);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[llm-gateway] MCP server started on stdio');

  return server;
}
