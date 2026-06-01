import { dynamicPluginToolTimeoutMs } from '../core/mcp-runtime-config.js';
import type { McpServerDefinition, ToolPattern, ToolResult } from './index.js';

interface RegisteredDynamicTool {
  plugin: string;
  pattern: ToolPattern;
}

const DYNAMIC_TOOL_ERROR = {
  EXECUTION_FAILED: 'dynamic-tool-error',
  TIMEOUT: 'dynamic-tool-timeout',
} as const;

class DynamicToolTimeoutError extends Error {
  constructor(readonly toolName: string, readonly plugin: string, readonly timeoutMs: number) {
    super(`Dynamic tool timed out after ${timeoutMs}ms`);
    this.name = 'DynamicToolTimeoutError';
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export class McpDefinitionAdapter {
  private dynamicTools: Map<string, RegisteredDynamicTool> = new Map();

  register(server: unknown, definition: McpServerDefinition, pluginName: string = definition.name): void {
    for (const tool of definition.tools) {
      // Register on SDK Server if it has the tool() method (McpServer)
      const s = server as Record<string, unknown>;
      if (typeof s.tool === 'function') {
        s.tool(tool.name, tool.description, tool.inputSchema, async (args: Record<string, unknown>) => {
          const result = await this.executeTool(tool.name, args);
          return this.mapResult(result ?? this.createExecutionErrorResult(tool.name, pluginName, 'Dynamic tool is not registered'));
        });
      }
      this.dynamicTools.set(tool.name, { plugin: pluginName, pattern: tool });
    }
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult | undefined> {
    const entry = this.dynamicTools.get(name);
    if (!entry) return undefined;

    const timeoutMs = dynamicPluginToolTimeoutMs();

    try {
      return await withTimeout(
        entry.pattern.handler(args),
        timeoutMs,
        () => new DynamicToolTimeoutError(name, entry.plugin, timeoutMs),
      );
    } catch (error) {
      if (error instanceof DynamicToolTimeoutError) {
        return this.createTimeoutResult(error.toolName, error.plugin, error.timeoutMs);
      }

      const message = error instanceof Error ? error.message : String(error);
      return this.createExecutionErrorResult(name, entry.plugin, message);
    }
  }

  private mapResult(result: ToolResult): any {
    // Map builder ToolResult to SDK expected shape
    return {
      content: result.content,
      ...(result.isError ? { isError: true } : {}),
    };
  }

  getToolNames(): string[] {
    return Array.from(this.dynamicTools.keys());
  }

  hasTool(name: string): boolean {
    return this.dynamicTools.has(name);
  }

  getTool(name: string): ToolPattern | undefined {
    return this.dynamicTools.get(name)?.pattern;
  }

  getToolListEntries(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return Array.from(this.dynamicTools.values()).map(({ pattern }) => ({
      name: pattern.name,
      description: pattern.description,
      inputSchema: pattern.inputSchema,
    }));
  }

  private createTimeoutResult(toolName: string, plugin: string, timeoutMs: number): ToolResult {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Dynamic tool '${toolName}' timed out after ${timeoutMs}ms`,
          code: DYNAMIC_TOOL_ERROR.TIMEOUT,
          toolName,
          plugin,
          timeoutMs,
        }),
      }],
      isError: true,
    };
  }

  private createExecutionErrorResult(toolName: string, plugin: string, message: string): ToolResult {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: message,
          code: DYNAMIC_TOOL_ERROR.EXECUTION_FAILED,
          toolName,
          plugin,
        }),
      }],
      isError: true,
    };
  }
}
