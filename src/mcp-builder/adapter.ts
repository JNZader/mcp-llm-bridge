import { dynamicPluginToolTimeoutMs } from '../core/mcp-runtime-config.js';
import type { McpServerDefinition, ToolPattern, ToolResult } from './index.js';

interface RegisteredDynamicTool {
  plugin: string;
  pattern: ToolPattern;
  runtime: DynamicToolRuntimeState;
}

const DYNAMIC_TOOL_ERROR = {
  EXECUTION_FAILED: 'dynamic-tool-error',
  TIMEOUT: 'dynamic-tool-timeout',
  QUARANTINED: 'dynamic-tool-quarantined',
} as const;

const DYNAMIC_TOOL_STATUS = {
  HEALTHY: 'healthy',
  QUARANTINED: 'quarantined',
} as const;

const DYNAMIC_TOOL_QUARANTINE_THRESHOLD = 2;

type DynamicToolErrorCode = (typeof DYNAMIC_TOOL_ERROR)[keyof typeof DYNAMIC_TOOL_ERROR];
type DynamicToolStatus = (typeof DYNAMIC_TOOL_STATUS)[keyof typeof DYNAMIC_TOOL_STATUS];

interface DynamicToolRuntimeState {
  consecutiveFailures: number;
  quarantined: boolean;
  lastErrorCode?: DynamicToolErrorCode;
  lastErrorMessage?: string;
}

export interface DynamicToolRuntimeHealth {
  name: string;
  plugin: string;
  status: DynamicToolStatus;
  consecutiveFailures: number;
  quarantined: boolean;
  lastErrorCode?: DynamicToolErrorCode;
  lastErrorMessage?: string;
}

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
      this.dynamicTools.set(tool.name, {
        plugin: pluginName,
        pattern: tool,
        runtime: {
          consecutiveFailures: 0,
          quarantined: false,
        },
      });
    }
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult | undefined> {
    const entry = this.dynamicTools.get(name);
    if (!entry) return undefined;

    if (entry.runtime.quarantined) {
      return this.createQuarantinedResult(name, entry.plugin, entry.runtime.consecutiveFailures);
    }

    const timeoutMs = dynamicPluginToolTimeoutMs();

    try {
      const result = await withTimeout(
        entry.pattern.handler(args),
        timeoutMs,
        () => new DynamicToolTimeoutError(name, entry.plugin, timeoutMs),
      );
      this.resetRuntime(entry.runtime);
      return result;
    } catch (error) {
      if (error instanceof DynamicToolTimeoutError) {
        this.recordFailure(entry.runtime, DYNAMIC_TOOL_ERROR.TIMEOUT, error.message);
        return this.createTimeoutResult(error.toolName, error.plugin, error.timeoutMs);
      }

      const message = error instanceof Error ? error.message : String(error);
      this.recordFailure(entry.runtime, DYNAMIC_TOOL_ERROR.EXECUTION_FAILED, message);
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

  getRuntimeHealth(): DynamicToolRuntimeHealth[] {
    return Array.from(this.dynamicTools.values()).map(({ plugin, pattern, runtime }) => ({
      name: pattern.name,
      plugin,
      status: runtime.quarantined ? DYNAMIC_TOOL_STATUS.QUARANTINED : DYNAMIC_TOOL_STATUS.HEALTHY,
      consecutiveFailures: runtime.consecutiveFailures,
      quarantined: runtime.quarantined,
      lastErrorCode: runtime.lastErrorCode,
      lastErrorMessage: runtime.lastErrorMessage,
    }));
  }

  private resetRuntime(runtime: DynamicToolRuntimeState): void {
    runtime.consecutiveFailures = 0;
    runtime.quarantined = false;
    runtime.lastErrorCode = undefined;
    runtime.lastErrorMessage = undefined;
  }

  private recordFailure(runtime: DynamicToolRuntimeState, errorCode: DynamicToolErrorCode, message: string): void {
    runtime.consecutiveFailures += 1;
    runtime.lastErrorCode = errorCode;
    runtime.lastErrorMessage = message;
    if (runtime.consecutiveFailures >= DYNAMIC_TOOL_QUARANTINE_THRESHOLD) {
      runtime.quarantined = true;
    }
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

  private createQuarantinedResult(toolName: string, plugin: string, consecutiveFailures: number): ToolResult {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Dynamic tool '${toolName}' has been quarantined after ${consecutiveFailures} consecutive failures`,
          code: DYNAMIC_TOOL_ERROR.QUARANTINED,
          toolName,
          plugin,
          consecutiveFailures,
        }),
      }],
      isError: true,
    };
  }
}
