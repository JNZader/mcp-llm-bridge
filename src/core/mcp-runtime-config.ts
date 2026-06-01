/**
 * Runtime config readers for dynamic MCP server loading.
 *
 * These helpers intentionally read process.env at call time so tests and
 * runtime code can observe env mutations after module import.
 */

export const DEFAULT_MCP_SERVERS_DIR = './mcp-servers';
export const DEFAULT_MCP_PLUGIN_LOAD_TIMEOUT_MS = 5_000;
export const DEFAULT_MCP_PLUGIN_TOOL_TIMEOUT_MS = 10_000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function dynamicMcpServersEnabled(): boolean {
  return process.env['MCP_DYNAMIC_SERVERS'] === 'true';
}

export function mcpServersDir(): string {
  return process.env['MCP_SERVERS_DIR'] || DEFAULT_MCP_SERVERS_DIR;
}

export function dynamicPluginLoadTimeoutMs(): number {
  return readPositiveIntEnv('MCP_PLUGIN_LOAD_TIMEOUT_MS', DEFAULT_MCP_PLUGIN_LOAD_TIMEOUT_MS);
}

export function dynamicPluginToolTimeoutMs(): number {
  return readPositiveIntEnv('MCP_PLUGIN_TOOL_TIMEOUT_MS', DEFAULT_MCP_PLUGIN_TOOL_TIMEOUT_MS);
}
