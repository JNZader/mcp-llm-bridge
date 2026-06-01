import { describe, it } from 'node:test';
import assert from 'node:assert';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpDefinitionAdapter } from '../../src/mcp-builder/adapter.js';
import type { McpServerDefinition, ToolPattern, ToolResult } from '../../src/mcp-builder/index.js';

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

function parseToolPayload(result: ToolResult) {
  const first = result.content[0];
  assert.ok(first && first.type === 'text', 'expected text tool result');
  return JSON.parse(first.text) as Record<string, unknown>;
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
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'boom',
          code: 'dynamic-tool-error',
          toolName: 'fail',
          plugin: 'test-server',
        }),
      }],
      isError: true,
    });
  });

  it('bounds hanging handler execution with a structured timeout result', async () => {
    const mockServer = createMockServer();
    const adapter = new McpDefinitionAdapter();

    const definition: McpServerDefinition = {
      name: 'timeout-plugin',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'hang',
          description: 'Never resolves',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => new Promise<ToolResult>(() => {}),
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS = '20';

    try {
      adapter.register(mockServer as any, definition);

      const handler = mockServer.getToolHandler('hang');
      assert.ok(handler, 'handler should be registered');

      const startedAt = Date.now();
      const result = await handler!({});
      const elapsedMs = Date.now() - startedAt;

      assert.ok(elapsedMs < 250, `execution should be bounded, got ${elapsedMs}ms`);
      assert.deepStrictEqual(result, {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: "Dynamic tool 'hang' timed out after 20ms",
            code: 'dynamic-tool-timeout',
            toolName: 'hang',
            plugin: 'timeout-plugin',
            timeoutMs: 20,
          }),
        }],
        isError: true,
      });
    } finally {
      delete process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS;
    }
  });

  it('quarantines a tool after repeated execution failures', async () => {
    const mockServer = createMockServer();
    const adapter = new McpDefinitionAdapter();
    let invocations = 0;

    const definition: McpServerDefinition = {
      name: 'failing-plugin',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'always_fail',
          description: 'Always fails',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            invocations += 1;
            throw new Error(`boom-${invocations}`);
          },
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    adapter.register(mockServer as never, definition);

    const first = await adapter.executeTool('always_fail', {});
    const second = await adapter.executeTool('always_fail', {});
    const third = await adapter.executeTool('always_fail', {});

    assert.equal(invocations, 2, 'quarantined tool should stop invoking the handler');
    assert.equal(parseToolPayload(first!).code, 'dynamic-tool-error');
    assert.equal(parseToolPayload(second!).code, 'dynamic-tool-error');
    assert.deepStrictEqual(parseToolPayload(third!), {
      error: "Dynamic tool 'always_fail' has been quarantined after 2 consecutive failures",
      code: 'dynamic-tool-quarantined',
      toolName: 'always_fail',
      plugin: 'failing-plugin',
      consecutiveFailures: 2,
    });
    assert.deepStrictEqual(adapter.getRuntimeHealth(), [{
      name: 'always_fail',
      plugin: 'failing-plugin',
      status: 'quarantined',
      consecutiveFailures: 2,
      quarantined: true,
      lastErrorCode: 'dynamic-tool-error',
      lastErrorMessage: 'boom-2',
    }]);
  });

  it('quarantines a tool after repeated timeouts', async () => {
    const mockServer = createMockServer();
    const adapter = new McpDefinitionAdapter();
    let invocations = 0;

    const definition: McpServerDefinition = {
      name: 'timeout-plugin',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'always_hang',
          description: 'Never resolves',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            invocations += 1;
            return new Promise<ToolResult>(() => {});
          },
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS = '20';

    try {
      adapter.register(mockServer as never, definition);

      const first = await adapter.executeTool('always_hang', {});
      const second = await adapter.executeTool('always_hang', {});
      const third = await adapter.executeTool('always_hang', {});

      assert.equal(invocations, 2, 'quarantined tool should stop invoking the handler');
      assert.equal(parseToolPayload(first!).code, 'dynamic-tool-timeout');
      assert.equal(parseToolPayload(second!).code, 'dynamic-tool-timeout');
      assert.deepStrictEqual(parseToolPayload(third!), {
        error: "Dynamic tool 'always_hang' has been quarantined after 2 consecutive failures",
        code: 'dynamic-tool-quarantined',
        toolName: 'always_hang',
        plugin: 'timeout-plugin',
        consecutiveFailures: 2,
      });
    } finally {
      delete process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS;
    }
  });

  it('leaves healthy tools unaffected and resets failure tracking on success', async () => {
    const adapter = new McpDefinitionAdapter();
    let invocations = 0;

    const definition: McpServerDefinition = {
      name: 'healthy-plugin',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'healthy_tool',
          description: 'Always succeeds',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            invocations += 1;
            return { content: [{ type: 'text', text: `ok-${invocations}` }] };
          },
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    adapter.register(createMockServer() as never, definition);

    assert.deepStrictEqual(await adapter.executeTool('healthy_tool', {}), {
      content: [{ type: 'text', text: 'ok-1' }],
    });
    assert.deepStrictEqual(await adapter.executeTool('healthy_tool', {}), {
      content: [{ type: 'text', text: 'ok-2' }],
    });
    assert.equal(invocations, 2);
    assert.deepStrictEqual(adapter.getRuntimeHealth(), [{
      name: 'healthy_tool',
      plugin: 'healthy-plugin',
      status: 'healthy',
      consecutiveFailures: 0,
      quarantined: false,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    }]);
  });

  it('keeps one broken tool from affecting a healthy sibling tool', async () => {
    const adapter = new McpDefinitionAdapter();
    let brokenInvocations = 0;
    let healthyInvocations = 0;

    const definition: McpServerDefinition = {
      name: 'mixed-plugin',
      version: '1.0.0',
      description: 'Test server',
      tools: [
        {
          name: 'broken_tool',
          description: 'Fails repeatedly',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            brokenInvocations += 1;
            throw new Error('broken');
          },
        } satisfies ToolPattern,
        {
          name: 'healthy_tool',
          description: 'Keeps working',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            healthyInvocations += 1;
            return { content: [{ type: 'text', text: 'still-ok' }] };
          },
        } satisfies ToolPattern,
      ],
      resources: [],
      prompts: [],
    };

    adapter.register(createMockServer() as never, definition);

    await adapter.executeTool('broken_tool', {});
    await adapter.executeTool('broken_tool', {});
    const quarantined = await adapter.executeTool('broken_tool', {});
    const healthy = await adapter.executeTool('healthy_tool', {});

    assert.equal(brokenInvocations, 2);
    assert.equal(healthyInvocations, 1);
    assert.equal(parseToolPayload(quarantined!).code, 'dynamic-tool-quarantined');
    assert.deepStrictEqual(healthy, {
      content: [{ type: 'text', text: 'still-ok' }],
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
