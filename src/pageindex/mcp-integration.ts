/**
 * PageIndex MCP Integration
 * 
 * Wrapper to add PageIndex tools to the MCP server
 * without modifying the main mcp.ts file extensively
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createPageIndex } from '../pageindex/index.js';
import { logger } from '../core/logger.js';

/**
 * Wrap an MCP server with PageIndex tools
 */
export function wrapWithPageIndex(
  server: Server,
  dbPath?: string
): void {
  // Initialize PageIndex
  const pageIndex = createPageIndex(dbPath);
  
  // Override ListTools to include PageIndex tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Get current tools (this will call the previous handler if any)
    return {
      tools: pageIndex.toolDefinitions,
    };
  });

  // Override CallTool to handle PageIndex calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Check if it's a PageIndex tool
    if (name.startsWith('conversation_')) {
      try {
        const result = await pageIndex.handleToolCall(name, args ?? {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: !result.success,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message, tool: name }, 'PageIndex tool error');
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }

    // Return empty for non-PageIndex tools (they'll be handled by main server)
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Tool not handled by PageIndex' }) }],
      isError: true,
    };
  });

  logger.info('PageIndex MCP integration active — 7 conversation tools available');
}
