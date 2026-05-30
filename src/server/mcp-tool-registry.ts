import type { McpDefinitionAdapter } from '../mcp-builder/adapter.js';
import { PAGEINDEX_TOOL_DEFINITIONS } from '../pageindex/tools.js';

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

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
        mode: {
          type: 'string',
          enum: ['keyword', 'vector', 'hybrid'],
          default: 'keyword',
          description: 'Search strategy: keyword (exact/prefix/fuzzy), vector (semantic similarity), or hybrid (RRF fusion of all)',
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
  ...PAGEINDEX_TOOL_DEFINITIONS,
] as const satisfies readonly McpToolDefinition[];

export function getRuntimeMcpTools(
  dynamicToolAdapter?: Pick<McpDefinitionAdapter, 'getToolListEntries'>,
): McpToolDefinition[] {
  return [
    ...TOOLS,
    ...(dynamicToolAdapter?.getToolListEntries() ?? []),
  ];
}
