import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { McpDefinitionAdapter } from '../../src/mcp-builder/adapter.js';
import type { McpServerDefinition, ToolResult } from '../../src/mcp-builder/index.js';

const CANARY = 'raw-tool-plugin-error-canary';
const TOOL_NAME = `tool_${CANARY}`;
const PLUGIN_NAME = `plugin_${CANARY}`;
const SAFE_ERROR_MESSAGES = {
  execution: 'Dynamic tool execution failed.',
  timeout: 'Dynamic tool execution timed out.',
  quarantined: 'Dynamic tool is quarantined.',
} as const;

type DynamicHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
type SdkHandler = (args: Record<string, unknown>) => Promise<unknown>;

function successfulResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function definition(handler: DynamicHandler): McpServerDefinition {
  return {
    name: PLUGIN_NAME,
    version: '1.0.0',
    description: 'dynamic fixture',
    tools: [{
      name: TOOL_NAME,
      description: 'dynamic fixture tool',
      inputSchema: { type: 'object' },
      handler,
    }],
    resources: [],
    prompts: [],
  };
}

function assertSafeError(result: ToolResult, code: string, message: string): void {
  assert.deepEqual(result, {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: message, code }) }],
  });
  assert.equal(JSON.stringify(result).includes(CANARY), false);
}

async function withTimeout(timeoutMs: string, run: () => Promise<void>): Promise<void> {
  const previousTimeout = process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS;
  try {
    process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS = timeoutMs;
    await run();
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS;
    } else {
      process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS = previousTimeout;
    }
  }
}

async function invokeRegisteredTool(handler: DynamicHandler): Promise<unknown> {
  let registeredHandler: SdkHandler | undefined;
  const server = {
    tool: (_name: string, _description: string, _schema: Record<string, unknown>, callback: SdkHandler) => {
      registeredHandler = callback;
    },
  };
  const adapter = new McpDefinitionAdapter();
  adapter.register(server, definition(handler));
  return registeredHandler!({});
}

describe('ERR-MCP-DYNAMIC', () => {
  it('MCP-DYN-01 preserves successful dynamic output without isError', async () => {
    const adapter = new McpDefinitionAdapter();
    adapter.register({}, definition(async () => successfulResult('successful-content')));

    assert.deepEqual(await adapter.executeTool(TOOL_NAME, {}), successfulResult('successful-content'));
  });

  it('MCP-DYN-02 projects Error failures without tool, plugin, or error canaries', async () => {
    const adapter = new McpDefinitionAdapter();
    adapter.register({}, definition(async () => { throw new Error(CANARY); }));

    assertSafeError((await adapter.executeTool(TOOL_NAME, {}))!, 'dynamic-tool-error', SAFE_ERROR_MESSAGES.execution);
  });

  it('MCP-DYN-03 projects non-Error failures through the same safe envelope', async () => {
    const adapter = new McpDefinitionAdapter();
    adapter.register({}, definition(async () => { throw { cause: CANARY }; }));

    assertSafeError((await adapter.executeTool(TOOL_NAME, {}))!, 'dynamic-tool-error', SAFE_ERROR_MESSAGES.execution);
  });

  it('MCP-DYN-04 returns the constant timeout envelope without runtime metadata', async () => {
    await withTimeout('1', async () => {
      const adapter = new McpDefinitionAdapter();
      adapter.register({}, definition(async () => new Promise<ToolResult>(() => {})));
      assertSafeError((await adapter.executeTool(TOOL_NAME, {}))!, 'dynamic-tool-timeout', SAFE_ERROR_MESSAGES.timeout);
    });
  });

  it('MCP-DYN-05 retains only the error code in runtime health after a failure', async () => {
    const adapter = new McpDefinitionAdapter();
    adapter.register({}, definition(async () => { throw new Error(CANARY); }));
    await adapter.executeTool(TOOL_NAME, {});

    const health = adapter.getRuntimeHealth()[0]!;
    assert.equal(health.lastErrorCode, 'dynamic-tool-error');
    assert.equal('lastErrorMessage' in health, false);
  });

  it('MCP-DYN-06 quarantines repeated failures with the constant safe result', async () => {
    const adapter = new McpDefinitionAdapter();
    adapter.register({}, definition(async () => { throw new Error(CANARY); }));
    await adapter.executeTool(TOOL_NAME, {});
    await adapter.executeTool(TOOL_NAME, {});

    assertSafeError((await adapter.executeTool(TOOL_NAME, {}))!, 'dynamic-tool-quarantined', SAFE_ERROR_MESSAGES.quarantined);
  });

  it('MCP-DYN-07 resets runtime failure state after a successful result', async () => {
    let shouldFail = true;
    const adapter = new McpDefinitionAdapter();
    adapter.register({}, definition(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error(CANARY);
      }
      return successfulResult('recovered');
    }));
    await adapter.executeTool(TOOL_NAME, {});

    assert.deepEqual(await adapter.executeTool(TOOL_NAME, {}), successfulResult('recovered'));
    assert.deepEqual(adapter.getRuntimeHealth()[0], {
      name: TOOL_NAME,
      plugin: PLUGIN_NAME,
      status: 'healthy',
      consecutiveFailures: 0,
      quarantined: false,
      lastErrorCode: undefined,
    });
  });

  it('MCP-DYN-08 maps registered successful output without adding isError', async () => {
    assert.deepEqual(
      await invokeRegisteredTool(async () => successfulResult('sdk-success')),
      successfulResult('sdk-success'),
    );
  });

  it('MCP-DYN-09 maps an invalid registered result to the safe isError envelope', async () => {
    assertSafeError(
      (await invokeRegisteredTool(async () => undefined as never)) as ToolResult,
      'dynamic-tool-error',
      SAFE_ERROR_MESSAGES.execution,
    );
  });
});
