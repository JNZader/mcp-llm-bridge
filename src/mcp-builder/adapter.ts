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

const DYNAMIC_TOOL_ERROR_MESSAGE = {
  EXECUTION_FAILED: 'Dynamic tool execution failed.',
  TIMEOUT: 'Dynamic tool execution timed out.',
  QUARANTINED: 'Dynamic tool is quarantined.',
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
}

export interface DynamicToolRuntimeHealth {
  name: string;
  plugin: string;
  status: DynamicToolStatus;
  consecutiveFailures: number;
  quarantined: boolean;
  lastErrorCode?: DynamicToolErrorCode;
  /** @deprecated Raw dynamic-tool errors are intentionally never retained. */
  lastErrorMessage?: undefined;
}

class DynamicToolTimeoutError extends Error {
  constructor() {
    super(DYNAMIC_TOOL_ERROR_MESSAGE.TIMEOUT);
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
          return this.mapResult(result ?? this.createExecutionErrorResult());
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
      return this.createQuarantinedResult();
    }

    const timeoutMs = dynamicPluginToolTimeoutMs();

    try {
      const result = await withTimeout(
        entry.pattern.handler(args),
        timeoutMs,
        () => new DynamicToolTimeoutError(),
      );
      this.resetRuntime(entry.runtime);
      return result;
    } catch (error) {
      if (error instanceof DynamicToolTimeoutError) {
        this.recordFailure(entry.runtime, DYNAMIC_TOOL_ERROR.TIMEOUT);
        return this.createTimeoutResult();
      }

      this.recordFailure(entry.runtime, DYNAMIC_TOOL_ERROR.EXECUTION_FAILED);
      return this.createExecutionErrorResult();
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
    }));
  }

  private resetRuntime(runtime: DynamicToolRuntimeState): void {
    runtime.consecutiveFailures = 0;
    runtime.quarantined = false;
    runtime.lastErrorCode = undefined;
  }

  private recordFailure(runtime: DynamicToolRuntimeState, errorCode: DynamicToolErrorCode): void {
    runtime.consecutiveFailures += 1;
    runtime.lastErrorCode = errorCode;
    if (runtime.consecutiveFailures >= DYNAMIC_TOOL_QUARANTINE_THRESHOLD) {
      runtime.quarantined = true;
    }
  }

  private createTimeoutResult(): ToolResult {
    return this.createSafeErrorResult(DYNAMIC_TOOL_ERROR.TIMEOUT);
  }

  private createExecutionErrorResult(): ToolResult {
    return this.createSafeErrorResult(DYNAMIC_TOOL_ERROR.EXECUTION_FAILED);
  }

  private createQuarantinedResult(): ToolResult {
    return this.createSafeErrorResult(DYNAMIC_TOOL_ERROR.QUARANTINED);
  }

  private createSafeErrorResult(code: DynamicToolErrorCode): ToolResult {
    const message = code === DYNAMIC_TOOL_ERROR.EXECUTION_FAILED
      ? DYNAMIC_TOOL_ERROR_MESSAGE.EXECUTION_FAILED
      : code === DYNAMIC_TOOL_ERROR.TIMEOUT
        ? DYNAMIC_TOOL_ERROR_MESSAGE.TIMEOUT
        : DYNAMIC_TOOL_ERROR_MESSAGE.QUARANTINED;
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message, code }) }],
      isError: true,
    };
  }
}
