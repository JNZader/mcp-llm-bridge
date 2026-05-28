import { describe, it } from 'node:test';
import assert from 'node:assert';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpDefinitionAdapter } from '../../src/mcp-builder/adapter.js';
import type { McpServerDefinition, ToolPattern } from '../../src/mcp-builder/index.js';

/** Minimal mock of McpServer that captures tool handlers for testing. */
function createMockServer() {
  const tools = new Map<string, (...args: any[]) => any>();
  return {
    tool(name: string, _description: string, _inputSchema: Record<string, unknown>, handler: (...args: any[]) => any) {
      tools.set(name, handler);
    },
    getToolHandler(name: string) {
      return tools.get(name);
    },
  };
}

describe('McpDefinitionAdapter', () => {
  it('register() adds tools to McpServer', () => {
    const server = new McpServer({ name: 'test', version: '1.0' });
    const adapter = new McpDefinitionAdapter();

    const definition: McpServerDefinition = {
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [{ type: 'text', text: 'hello' }] }),
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    adapter.register(server, definition);

    assert.deepStrictEqual(adapter.getToolNames(), ['test_tool']);
    assert.strictEqual(adapter.hasTool('test_tool'), true);
  });

  it('handler executes and returns mapped result', async () => {
    const mockServer = createMockServer();
    const adapter = new McpDefinitionAdapter();

    const definition: McpServerDefinition = {
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'echo',
          description: 'Echo tool',
          inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
          handler: async (args) => ({
            content: [{ type: 'text', text: String(args['msg']) }],
          }),
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    adapter.register(mockServer as any, definition);

    const handler = mockServer.getToolHandler('echo');
    assert.ok(handler, 'handler should be registered');
    const result = await handler!({ msg: 'hello world' });
    assert.deepStrictEqual(result, {
      content: [{ type: 'text', text: 'hello world' }],
    });
  });

  it('handler error returns isError', async () => {
    const mockServer = createMockServer();
    const adapter = new McpDefinitionAdapter();

    const definition: McpServerDefinition = {
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'fail',
          description: 'Always fails',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            throw new Error('boom');
          },
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    adapter.register(mockServer as any, definition);

    const handler = mockServer.getToolHandler('fail');
    assert.ok(handler, 'handler should be registered');
    const result = await handler!({});
    assert.deepStrictEqual(result, {
      content: [{ type: 'text', text: 'Error: Error: boom' }],
      isError: true,
    });
  });

  it('getToolNames() returns registered names', () => {
    const server = new McpServer({ name: 'test', version: '1.0' });
    const adapter = new McpDefinitionAdapter();

    const definition: McpServerDefinition = {
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'tool_a',
          description: 'Tool A',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [] }),
        } satisfies ToolPattern,
        {
          name: 'tool_b',
          description: 'Tool B',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [] }),
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    adapter.register(server, definition);

    const names = adapter.getToolNames();
    assert.strictEqual(names.length, 2);
    assert(names.includes('tool_a'));
    assert(names.includes('tool_b'));
  });

  it('hasTool() checks existence', () => {
    const server = new McpServer({ name: 'test', version: '1.0' });
    const adapter = new McpDefinitionAdapter();

    const definition: McpServerDefinition = {
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'only_one',
          description: 'Only tool',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ content: [] }),
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    adapter.register(server, definition);

    assert.strictEqual(adapter.hasTool('only_one'), true);
    assert.strictEqual(adapter.hasTool('missing'), false);
  });
});
