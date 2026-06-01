/**
 * E2E integration tests for mcp-builder dynamic plugin loading.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { Vault } from '../../src/vault/vault.js';
import { Router } from '../../src/core/router.js';
import { createAllAdapters } from '../../src/adapters/index.js';
import type { GatewayConfig } from '../../src/core/types.js';
import { startMcpServer, handleToolCall } from '../../src/server/mcp.js';
import { dynamicToolAdapter } from '../../src/server/mcp.js';
import { getDynamicPluginLoadSummary, getRuntimeMcpTools } from '../../src/server/mcp.js';
import { ProfileEnforcer } from '../../src/security/enforcer.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-mcp-builder-e2e-${Date.now()}.db`,
  httpPort: 0,
};

const vault = new Vault(config);
const router = new Router();
for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}

process.on('exit', () => {
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

let tempDir: string;
let server: any;

before(async () => {
  tempDir = join(tmpdir(), `mcp-builder-e2e-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
});

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
  if (server?.close) {
    await server.close();
  }
});

// ── Server start scenarios ───────────────────────────────────

describe('MCP dynamic server startup', () => {
  it('server starts with MCP_DYNAMIC_SERVERS=false → no dynamic tools', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'false';
    delete process.env.MCP_SERVERS_DIR;

    server = await startMcpServer({ router, vault });
    assert.ok(server, 'server should start');
    assert.equal(dynamicToolAdapter, undefined);
    assert.deepStrictEqual(getDynamicPluginLoadSummary(), {
      enabled: false,
      directory: './mcp-servers',
      loaded: [],
      skipped: [],
      errors: [],
      collisions: [],
    });

    // Verify no dynamic tools by calling a non-existent dynamic tool
    const result = await handleToolCall('dynamic_greet', { name: 'test' }, router, vault);
    assert.ok(result.isError, 'should return error');
    assert.ok(result.content[0]!.text.includes('Unknown tool'), 'should report unknown tool');

    await server.close();
    server = null;
  });

  it('server starts with default ./mcp-servers directory when MCP_SERVERS_DIR is unset', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    delete process.env.MCP_SERVERS_DIR;

    const originalCwd = process.cwd();
    const appRoot = join(tempDir, 'default-dir-app');
    const defaultPluginsDir = join(appRoot, 'mcp-servers');

    await mkdir(defaultPluginsDir, { recursive: true });

    const pluginContent = `
      export default {
        name: 'default-dir-plugin',
        version: '1.0.0',
        description: 'Default directory plugin',
        tools: [
          {
            name: 'dynamic_default_dir',
            description: 'Loads from default directory',
            inputSchema: { type: 'object', properties: {} },
            security: { category: 'read' },
            handler: async () => ({
              content: [{ type: 'text', text: 'loaded from default dir' }],
            }),
          },
        ],
        resources: [],
        prompts: [],
      };
    `;
    await writeFile(join(defaultPluginsDir, 'default-dir.mcp-server.js'), pluginContent, 'utf-8');

    try {
      process.chdir(appRoot);

      server = await startMcpServer({ router, vault });
      assert.ok(server, 'server should start');

      assert.ok(dynamicToolAdapter, 'dynamicToolAdapter should be set');
      assert.equal(dynamicToolAdapter!.hasTool('dynamic_default_dir'), true);
      assert.deepStrictEqual(getDynamicPluginLoadSummary().loaded, [
        {
          plugin: 'default-dir',
          toolCount: 1,
          toolNames: ['dynamic_default_dir'],
        },
      ]);

      const result = await handleToolCall('dynamic_default_dir', {}, router, vault);
      assert.ok(!result.isError, 'should not error');
      assert.ok(result.content[0]!.text.includes('loaded from default dir'));

      await server.close();
      server = null;
    } finally {
      process.chdir(originalCwd);
      await rm(join(defaultPluginsDir, 'default-dir.mcp-server.js'), { force: true });
    }
  });

  it('server starts with MCP_DYNAMIC_SERVERS=true + valid plugin dir → dynamic tools loaded', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    // Create a valid plugin file
    const pluginContent = `
      export default {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin',
        tools: [
          {
            name: 'dynamic_greet',
            description: 'A dynamic greeting tool',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
            security: { category: 'read' },
            handler: async (args) => ({
              content: [{ type: 'text', text: 'Hello, ' + args.name + '!' }],
            }),
          },
        ],
        resources: [],
        prompts: [],
      };
    `;
    await writeFile(join(tempDir, 'test.mcp-server.js'), pluginContent, 'utf-8');

    server = await startMcpServer({ router, vault });
    assert.ok(server, 'server should start');

    // Verify dynamic tool is loaded
    assert.ok(dynamicToolAdapter, 'dynamicToolAdapter should be set');
    assert.strictEqual(dynamicToolAdapter!.hasTool('dynamic_greet'), true);
    assert.deepStrictEqual(getDynamicPluginLoadSummary().loaded, [
      {
        plugin: 'test',
        toolCount: 1,
        toolNames: ['dynamic_greet'],
      },
    ]);

    // Test dynamic tool execution via handleToolCall
    const result = await handleToolCall('dynamic_greet', { name: 'World' }, router, vault);
    assert.ok(!result.isError, 'should not error');
    assert.ok(result.content[0]!.text.includes('Hello, World!'), 'should return greeting');

    await server.close();
    server = null;

    // Cleanup plugin file
    await rm(join(tempDir, 'test.mcp-server.js'));
  });

  it('server starts with MCP_DYNAMIC_SERVERS=true + empty dir → no dynamic tools, no crash', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    // Ensure directory is empty
    const files = await readdir(tempDir);
    for (const file of files) {
      await rm(join(tempDir, file), { recursive: true, force: true });
    }

    server = await startMcpServer({ router, vault });
    assert.ok(server, 'server should start without crashing');

    // Verify no dynamic tools
    assert.ok(dynamicToolAdapter, 'dynamicToolAdapter should be created');
    assert.strictEqual(dynamicToolAdapter!.getToolNames().length, 0, 'should have no tools');
    assert.deepStrictEqual(getDynamicPluginLoadSummary(), {
      enabled: true,
      directory: tempDir,
      loaded: [],
      skipped: [],
      errors: [],
      collisions: [],
    });

    // Calling a non-existent tool should still return unknown tool
    const result = await handleToolCall('dynamic_greet', { name: 'test' }, router, vault);
    assert.ok(result.isError, 'should return error');
    assert.ok(result.content[0]!.text.includes('Unknown tool'), 'should report unknown tool');

    await server.close();
    server = null;
  });
});

// ── Dynamic tool execution ───────────────────────────────────

describe('Dynamic tool execution', () => {
  it('executes dynamic tool via MCP tool call', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    const pluginContent = `
      export default {
        name: 'exec-plugin',
        version: '1.0.0',
        description: 'Execution plugin',
        tools: [
          {
            name: 'dynamic_echo',
            description: 'Echo a message',
            inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
            security: { category: 'read' },
            handler: async (args) => ({
              content: [{ type: 'text', text: 'echo: ' + args.msg }],
            }),
          },
        ],
        resources: [],
        prompts: [],
      };
    `;
    await writeFile(join(tempDir, 'exec.mcp-server.js'), pluginContent, 'utf-8');

    server = await startMcpServer({ router, vault });

    const result = await handleToolCall('dynamic_echo', { msg: 'hi' }, router, vault);
    assert.ok(!result.isError);
    assert.ok(result.content[0]!.text.includes('echo: hi'));

    await server.close();
    server = null;
    await rm(join(tempDir, 'exec.mcp-server.js'));
  });

  it('returns a bounded timeout error for a hanging dynamic tool call', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;
    process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS = '25';

    const pluginContent = `
      export default {
        name: 'timeout-plugin',
        version: '1.0.0',
        description: 'Execution timeout plugin',
        tools: [
          {
            name: 'dynamic_hang',
            description: 'Never returns',
            inputSchema: { type: 'object', properties: {} },
            security: { category: 'read' },
            handler: async () => new Promise(() => {}),
          },
        ],
        resources: [],
        prompts: [],
      };
    `;
    await writeFile(join(tempDir, 'timeout.mcp-server.js'), pluginContent, 'utf-8');

    try {
      server = await startMcpServer({ router, vault });

      const startedAt = Date.now();
      const result = await handleToolCall('dynamic_hang', {}, router, vault);
      const elapsedMs = Date.now() - startedAt;

      assert.ok(elapsedMs < 250, `tool execution should be bounded, got ${elapsedMs}ms`);
      assert.equal(result.isError, true);
      assert.deepStrictEqual(JSON.parse(result.content[0]!.text), {
        error: "Dynamic tool 'dynamic_hang' timed out after 25ms",
        code: 'dynamic-tool-timeout',
        toolName: 'dynamic_hang',
        plugin: 'timeout',
        timeoutMs: 25,
      });
    } finally {
      await server?.close?.();
      server = null;
      delete process.env.MCP_PLUGIN_TOOL_TIMEOUT_MS;
      await rm(join(tempDir, 'timeout.mcp-server.js'), { force: true });
    }
  });
});

// ── Security profile blocking ───────────────────────────────

describe('Dynamic tool security profiles', () => {
  it('dynamic read tool is allowed in restricted when metadata category is read', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    const pluginContent = `
      export default {
        name: 'read-plugin',
        version: '1.0.0',
        description: 'Read plugin',
        tools: [
          {
            name: 'dynamic_read',
            description: 'A read tool',
            inputSchema: { type: 'object', properties: {} },
            security: { category: 'read' },
            handler: async () => ({
              content: [{ type: 'text', text: 'read result' }],
            }),
          },
        ],
        resources: [],
        prompts: [],
      };
    `;
    await writeFile(join(tempDir, 'read.mcp-server.js'), pluginContent, 'utf-8');

    server = await startMcpServer({ router, vault, securityProfile: 'restricted' });

    const enforcer = new ProfileEnforcer('restricted');
    enforcer.registerDynamicTool('dynamic_read', { category: 'read' });

    const result = await handleToolCall('dynamic_read', {}, router, vault, undefined, undefined, undefined, undefined, undefined, undefined, 'restricted', enforcer);

    assert.equal(result.isError, undefined);
    assert.equal(result.content[0]!.text, 'read result');

    enforcer.destroy();
    await server.close();
    server = null;
    await rm(join(tempDir, 'read.mcp-server.js'));
  });

  it('dynamic admin/destructive tools are blocked in restricted by metadata category', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    await writeFile(join(tempDir, 'blocked.mcp-server.js'), `
      export default {
        name: 'blocked-plugin',
        version: '1.0.0',
        description: 'Blocked tools plugin',
        tools: [
          {
            name: 'dynamic_admin',
            description: 'Admin tool',
            inputSchema: { type: 'object', properties: {} },
            security: { category: 'admin' },
            handler: async () => ({ content: [{ type: 'text', text: 'admin result' }] }),
          },
          {
            name: 'dynamic_destroy',
            description: 'Destructive tool',
            inputSchema: { type: 'object', properties: {} },
            security: { category: 'destructive' },
            handler: async () => ({ content: [{ type: 'text', text: 'destroy result' }] }),
          },
        ],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');

    server = await startMcpServer({ router, vault, securityProfile: 'restricted' });

    const enforcer = new ProfileEnforcer('restricted');
    enforcer.registerDynamicTool('dynamic_admin', { category: 'admin' });
    enforcer.registerDynamicTool('dynamic_destroy', { category: 'destructive' });

    const adminResult = await handleToolCall('dynamic_admin', {}, router, vault, undefined, undefined, undefined, undefined, undefined, undefined, 'restricted', enforcer);
    const destructiveResult = await handleToolCall('dynamic_destroy', {}, router, vault, undefined, undefined, undefined, undefined, undefined, undefined, 'restricted', enforcer);

    assert.equal(adminResult.isError, true);
    assert.equal(destructiveResult.isError, true);
    assert.ok(adminResult.content[0]!.text.includes('denied'));
    assert.ok(destructiveResult.content[0]!.text.includes('denied'));

    enforcer.destroy();
    await server.close();
    server = null;
    await rm(join(tempDir, 'blocked.mcp-server.js'));
  });

  it('quarantines tools with missing security metadata during admission', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    await writeFile(join(tempDir, 'quarantine.mcp-server.js'), `
      export default {
        name: 'quarantine-plugin',
        version: '1.0.0',
        description: 'Mixed security metadata plugin',
        tools: [
          {
            name: 'dynamic_safe',
            description: 'Valid security metadata',
            inputSchema: { type: 'object', properties: {} },
            security: { category: 'read' },
            handler: async () => ({ content: [{ type: 'text', text: 'safe' }] }),
          },
          {
            name: 'dynamic_quarantined',
            description: 'Missing security metadata',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => ({ content: [{ type: 'text', text: 'unsafe' }] }),
          },
        ],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');

    server = await startMcpServer({ router, vault });

    const summary = getDynamicPluginLoadSummary();
    assert.deepStrictEqual(summary.loaded, [{
      plugin: 'quarantine',
      toolCount: 1,
      toolNames: ['dynamic_safe'],
    }]);
    assert.strictEqual(summary.skipped.length, 1);
    assert.strictEqual(summary.skipped[0]!.toolName, 'dynamic_quarantined');
    assert.strictEqual(summary.skipped[0]!.code, 'invalid-tool-security');
    assert.equal(dynamicToolAdapter?.hasTool('dynamic_safe'), true);
    assert.equal(dynamicToolAdapter?.hasTool('dynamic_quarantined'), false);

    await server.close();
    server = null;
    await rm(join(tempDir, 'quarantine.mcp-server.js'));
  });

  it('dynamic requiresApproval metadata triggers approval flow when enabled', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;
    process.env.APPROVAL_FLOWS_ENABLED = 'true';

    await writeFile(join(tempDir, 'approval.mcp-server.js'), `
      export default {
        name: 'approval-plugin',
        version: '1.0.0',
        description: 'Approval plugin',
        tools: [{
          name: 'dynamic_approval',
          description: 'Requires approval despite being read-only',
          inputSchema: { type: 'object', properties: {} },
          security: { category: 'read', requiresApproval: true },
          handler: async () => ({ content: [{ type: 'text', text: 'should not execute immediately' }] }),
        }],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');

    try {
      server = await startMcpServer({ router, vault, securityProfile: 'restricted' });

      const approvalStore = new (await import('../../src/approval/index.js')).ApprovalStore();
      const enforcer = new ProfileEnforcer('restricted');
      enforcer.registerDynamicTool('dynamic_approval', { category: 'read', requiresApproval: true });

      const result = await handleToolCall(
        'dynamic_approval',
        {},
        router,
        vault,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        approvalStore,
        'restricted',
        enforcer,
      );

      const payload = JSON.parse(result.content[0]!.text);
      assert.equal(payload.approvalRequired, true);
      assert.equal(payload.toolName, 'dynamic_approval');
      assert.equal(approvalStore.getPending().length, 1);

      enforcer.destroy();
    } finally {
      await server?.close?.();
      server = null;
      delete process.env.APPROVAL_FLOWS_ENABLED;
      await rm(join(tempDir, 'approval.mcp-server.js'), { force: true });
    }
  });

  it('awaits delayed plugin loading before startup resolves', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    const pluginContent = `
      await new Promise((resolve) => setTimeout(resolve, 150));
      export default {
        name: 'delayed-plugin',
        version: '1.0.0',
        description: 'Delayed plugin',
        tools: [
          {
            name: 'dynamic_delayed',
            description: 'Loads before startup resolves',
            inputSchema: { type: 'object', properties: {} },
            security: { category: 'read' },
            handler: async () => ({
              content: [{ type: 'text', text: 'ready' }],
            }),
          },
        ],
        resources: [],
        prompts: [],
      };
    `;
    await writeFile(join(tempDir, 'delayed.mcp-server.js'), pluginContent, 'utf-8');

    const startedAt = Date.now();
    server = await startMcpServer({ router, vault });
    const elapsedMs = Date.now() - startedAt;

    assert.ok(elapsedMs >= 125, `startup should await plugin load, got ${elapsedMs}ms`);
    assert.ok(dynamicToolAdapter?.hasTool('dynamic_delayed'));

    await server.close();
    server = null;
    await rm(join(tempDir, 'delayed.mcp-server.js'));
  });

  it('quarantines a timed out plugin import without blocking a valid plugin', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;
    process.env.MCP_PLUGIN_LOAD_TIMEOUT_MS = '50';

    await writeFile(join(tempDir, 'hung.mcp-server.js'), `
      await new Promise(() => {});
      export default {
        name: 'hung-plugin',
        version: '1.0.0',
        description: 'Never finishes loading',
        tools: [],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');
    await writeFile(join(tempDir, 'healthy.mcp-server.js'), `
      export default {
        name: 'healthy-plugin',
        version: '1.0.0',
        description: 'Loads normally',
        tools: [{
          name: 'dynamic_healthy',
          description: 'Still available',
          inputSchema: { type: 'object', properties: {} },
          security: { category: 'read' },
          handler: async () => ({ content: [{ type: 'text', text: 'healthy' }] }),
        }],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');

    try {
      server = await startMcpServer({ router, vault });

      const summary = getDynamicPluginLoadSummary();
      assert.deepStrictEqual(summary.loaded, [{
        plugin: 'healthy',
        toolCount: 1,
        toolNames: ['dynamic_healthy'],
      }]);
      assert.strictEqual(summary.errors.length, 1);
      assert.strictEqual(summary.errors[0]!.plugin, 'hung');
      assert.strictEqual(summary.errors[0]!.code, 'load-timeout');

      const result = await handleToolCall('dynamic_healthy', {}, router, vault);
      assert.equal(result.isError, undefined);
      assert.equal(result.content[0]!.text, 'healthy');
    } finally {
      await server?.close?.();
      server = null;
      delete process.env.MCP_PLUGIN_LOAD_TIMEOUT_MS;
      await rm(join(tempDir, 'hung.mcp-server.js'), { force: true });
      await rm(join(tempDir, 'healthy.mcp-server.js'), { force: true });
    }
  });

  it('quarantines plugin collisions and exposes them in the load summary', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    await writeFile(join(tempDir, 'alpha.mcp-server.js'), `
      export default {
        name: 'alpha',
        version: '1.0.0',
        description: 'Alpha plugin',
        tools: [{
          name: 'dynamic_collision',
          description: 'first owner',
          inputSchema: { type: 'object', properties: {} },
          security: { category: 'read' },
          handler: async () => ({ content: [{ type: 'text', text: 'alpha' }] }),
        }],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');
    await writeFile(join(tempDir, 'beta.mcp-server.js'), `
      export default {
        name: 'beta',
        version: '1.0.0',
        description: 'Beta plugin',
        tools: [{
          name: 'dynamic_collision',
          description: 'duplicate owner',
          inputSchema: { type: 'object', properties: {} },
          security: { category: 'read' },
          handler: async () => ({ content: [{ type: 'text', text: 'beta' }] }),
        }],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');
    await writeFile(join(tempDir, 'builtin.mcp-server.js'), `
      export default {
        name: 'builtin',
        version: '1.0.0',
        description: 'Built-in collision plugin',
        tools: [{
          name: 'llm_generate',
          description: 'illegal override',
          inputSchema: { type: 'object', properties: {} },
          security: { category: 'generate' },
          handler: async () => ({ content: [{ type: 'text', text: 'override' }] }),
        }],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');

    server = await startMcpServer({ router, vault });

    const summary = getDynamicPluginLoadSummary();
    assert.deepStrictEqual(summary.loaded, [
      {
        plugin: 'alpha',
        toolCount: 1,
        toolNames: ['dynamic_collision'],
      },
    ]);
    assert.strictEqual(summary.collisions.length, 2);
    assert.deepStrictEqual(
      summary.collisions.map((entry) => ({
        plugin: entry.plugin,
        toolName: entry.toolName,
        code: entry.code,
        existingPlugin: entry.existingPlugin,
      })),
      [
        {
          plugin: 'beta',
          toolName: 'dynamic_collision',
          code: 'plugin-tool-name',
          existingPlugin: 'alpha',
        },
        {
          plugin: 'builtin',
          toolName: 'llm_generate',
          code: 'built-in-tool-name',
          existingPlugin: 'built-in',
        },
      ],
    );
    assert.ok(dynamicToolAdapter?.hasTool('dynamic_collision'));
    assert.equal(dynamicToolAdapter?.hasTool('llm_generate'), false);
    assert.equal(getRuntimeMcpTools().some((tool) => tool.name === 'dynamic_collision'), true);
    assert.equal(getRuntimeMcpTools().filter((tool) => tool.name === 'llm_generate').length, 1);

    await server.close();
    server = null;
    await rm(join(tempDir, 'alpha.mcp-server.js'));
    await rm(join(tempDir, 'beta.mcp-server.js'));
    await rm(join(tempDir, 'builtin.mcp-server.js'));
  });

  it('resets dynamic runtime state between startups', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    await writeFile(join(tempDir, 'first.mcp-server.js'), `
      export default {
        name: 'first',
        version: '1.0.0',
        description: 'First plugin',
        tools: [{
          name: 'dynamic_first',
          description: 'first tool',
          inputSchema: { type: 'object', properties: {} },
          security: { category: 'read' },
          handler: async () => ({ content: [{ type: 'text', text: 'first' }] }),
        }],
        resources: [],
        prompts: [],
      };
    `, 'utf-8');

    server = await startMcpServer({ router, vault });
    assert.ok(dynamicToolAdapter?.hasTool('dynamic_first'));
    await server.close();
    server = null;

    await rm(join(tempDir, 'first.mcp-server.js'));
    process.env.MCP_DYNAMIC_SERVERS = 'false';
    delete process.env.MCP_SERVERS_DIR;

    server = await startMcpServer({ router, vault });

    assert.equal(dynamicToolAdapter, undefined);
    assert.equal(getRuntimeMcpTools().some((tool) => tool.name === 'dynamic_first'), false);

    const result = await handleToolCall('dynamic_first', {}, router, vault);
    assert.ok(result.isError);
    assert.ok(result.content[0]!.text.includes('Unknown tool'));

    await server.close();
    server = null;
  });
});
