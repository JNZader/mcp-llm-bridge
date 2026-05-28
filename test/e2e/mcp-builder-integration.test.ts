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

    server = await startMcpServer(router, vault);
    assert.ok(server, 'server should start');

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

      server = await startMcpServer(router, vault);
      assert.ok(server, 'server should start');

      await new Promise((resolve) => setTimeout(resolve, 500));

      assert.ok(dynamicToolAdapter, 'dynamicToolAdapter should be set');
      assert.equal(dynamicToolAdapter!.hasTool('dynamic_default_dir'), true);

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

    server = await startMcpServer(router, vault);
    assert.ok(server, 'server should start');

    // Wait for async plugin loading
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify dynamic tool is loaded
    assert.ok(dynamicToolAdapter, 'dynamicToolAdapter should be set');
    assert.strictEqual(dynamicToolAdapter!.hasTool('dynamic_greet'), true);

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

    server = await startMcpServer(router, vault);
    assert.ok(server, 'server should start without crashing');

    // Wait for async plugin loading
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify no dynamic tools
    assert.ok(dynamicToolAdapter, 'dynamicToolAdapter should be created');
    assert.strictEqual(dynamicToolAdapter!.getToolNames().length, 0, 'should have no tools');

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

    server = await startMcpServer(router, vault);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await handleToolCall('dynamic_echo', { msg: 'hi' }, router, vault);
    assert.ok(!result.isError);
    assert.ok(result.content[0]!.text.includes('echo: hi'));

    await server.close();
    server = null;
    await rm(join(tempDir, 'exec.mcp-server.js'));
  });
});

// ── Security profile blocking ───────────────────────────────

describe('Dynamic tool security profiles', () => {
  it('dynamic tool blocked by restricted profile when category is admin', async () => {
    process.env.MCP_DYNAMIC_SERVERS = 'true';
    process.env.MCP_SERVERS_DIR = tempDir;

    const pluginContent = `
      export default {
        name: 'admin-plugin',
        version: '1.0.0',
        description: 'Admin plugin',
        tools: [
          {
            name: 'dynamic_admin',
            description: 'An admin tool',
            inputSchema: { type: 'object', properties: {} },
            handler: async () => ({
              content: [{ type: 'text', text: 'admin result' }],
            }),
          },
        ],
        resources: [],
        prompts: [],
      };
    `;
    await writeFile(join(tempDir, 'admin.mcp-server.js'), pluginContent, 'utf-8');

    const enforcer = new ProfileEnforcer('restricted');
    enforcer.registerDynamicTool('dynamic_admin', 'admin');

    server = await startMcpServer(router, vault, undefined, undefined, undefined, undefined, undefined, 'restricted');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // With the enforcer passed to handleToolCall, the tool should be blocked
    const result = await handleToolCall(
      'dynamic_admin',
      {},
      router,
      vault,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'restricted',
      enforcer,
    );

    assert.ok(result.isError, 'should be blocked');
    assert.ok(
      result.content[0]!.text.includes('denied') || result.content[0]!.text.includes('Access denied'),
      'should report access denied',
    );

    enforcer.destroy();
    await server.close();
    server = null;
    await rm(join(tempDir, 'admin.mcp-server.js'));
  });
});
