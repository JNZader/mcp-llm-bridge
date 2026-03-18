#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { detectProviders } from './detect.js';
import { generate } from './generate.js';

const server = new Server({
  name: 'mcp-llm-bridge',
  version: '0.1.0',
}, {
  capabilities: { tools: {} }
});

// Detect available CLI providers at startup
const providers = await detectProviders();
console.error(`[mcp-llm-bridge] Available providers: ${providers.map(p => p.name).join(', ') || 'none'}`);

// Register the tool
server.setRequestHandler('tools/list', async () => ({
  tools: [{
    name: 'llm_generate',
    description: `Generate text using an LLM via CLI subscription. Available providers: ${providers.map(p => p.name).join(', ')}. Uses your existing subscription — no API tokens needed.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The user prompt to send to the LLM' },
        system: { type: 'string', description: 'Optional system prompt (not all providers support this)' },
        provider: { type: 'string', description: `Preferred provider. Options: ${providers.map(p => p.name).join(', ')}. If omitted, uses the first available.`, enum: providers.map(p => p.name) },
      },
      required: ['prompt'],
    },
  }],
}));

server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name !== 'llm_generate') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { prompt, system, provider: preferredProvider } = request.params.arguments;
  const result = await generate(providers, { prompt, system, preferredProvider });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
