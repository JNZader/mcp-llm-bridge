import type { McpServerDefinition, ToolPattern, ToolResult } from './index.js';

export class McpDefinitionAdapter {
  private dynamicTools: Map<string, ToolPattern> = new Map();

  register(server: unknown, definition: McpServerDefinition): void {
    for (const tool of definition.tools) {
      // Register on SDK Server if it has the tool() method (McpServer)
      const s = server as Record<string, unknown>;
      if (typeof s.tool === 'function') {
        s.tool(tool.name, tool.description, tool.inputSchema, async (args: Record<string, unknown>) => {
          try {
            const result = await tool.handler(args);
            return this.mapResult(result);
          } catch (e) {
            return { content: [{ type: 'text', text: `Error: ${e}` }], isError: true };
          }
        });
      }
      this.dynamicTools.set(tool.name, tool);
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
    return this.dynamicTools.get(name);
  }

  getToolListEntries(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return Array.from(this.dynamicTools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }
}
