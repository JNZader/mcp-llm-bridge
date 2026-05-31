/**
 * Runtime config readers for dynamic MCP server loading.
 *
 * These helpers intentionally read process.env at call time so tests and
 * runtime code can observe env mutations after module import.
 */

export const DEFAULT_MCP_SERVERS_DIR = './mcp-servers';

export function dynamicMcpServersEnabled(): boolean {
  return process.env['MCP_DYNAMIC_SERVERS'] === 'true';
}

export function mcpServersDir(): string {
  return process.env['MCP_SERVERS_DIR'] || DEFAULT_MCP_SERVERS_DIR;
}
