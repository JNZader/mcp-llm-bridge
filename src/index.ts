#!/usr/bin/env node

/**
 * MCP LLM Bridge — entrypoint.
 *
 * Currently a minimal stub that starts the MCP server.
 * Full wiring with Router, Vault, and adapters will be done in Task 8.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Adapters are available but wiring through Router + Vault happens in Task 8
// import { createAllAdapters } from './adapters/index.js';

const server = new Server({
  name: 'mcp-llm-bridge',
  version: '0.3.0',
}, {
  capabilities: { tools: {} },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'llm_generate',
    description: 'Generate text using an LLM. Full provider routing coming in Task 8.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string', description: 'The user prompt to send to the LLM' },
        system: { type: 'string', description: 'Optional system prompt' },
        provider: { type: 'string', description: 'Preferred provider ID' },
        model: { type: 'string', description: 'Specific model ID' },
        maxTokens: { type: 'number', description: 'Maximum output tokens' },
      },
      required: ['prompt'],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (_request) => {
  // Placeholder — will be wired through Router in Task 8
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: 'Provider routing not yet wired. Complete Task 8.' }),
    }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
