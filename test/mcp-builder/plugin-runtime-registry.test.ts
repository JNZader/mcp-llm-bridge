import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { loadPlugins, loadWorkerPlugins, type PluginLoadSummary } from '../../src/mcp-builder/loader.js';
import { TOOLS } from '../../src/server/mcp-tool-registry.js';
import { createPluginRuntimeRegistry } from '../../src/mcp-builder/plugin-runtime-registry.js';
import type { PluginRuntimeManifest, PluginRuntimeSecurity, PluginRuntimeToolManifest } from '../../src/mcp-builder/plugin-runtime-protocol.js';
import { deferred, isExactMissingModule, withEnvironment } from './fixtures/plugin-runtime/unit3-harness.js';

interface InvalidRuntimeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  security?: {
    category: string;
    requiresApproval?: boolean;
  };
}

interface InvalidRuntimeManifest {
  v: 1;
  name: string;
  version: string;
  description: string;
  tools: InvalidRuntimeTool[];
}

interface RuntimeHandle {
  readonly identity: object;
  invoke(tool: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

interface RuntimeCandidate {
  filename: string;
  manifest: InvalidRuntimeManifest;
  handle: RuntimeHandle;
}

interface RuntimeRegistry {
  admit(candidate: RuntimeCandidate): Promise<void>;
  invoke(tool: string, args: Record<string, unknown>): Promise<unknown>;
  closeAll(): Promise<void>;
}

interface RegistryModule {
  createPluginRuntimeRegistry?: () => RuntimeRegistry;
}

interface WorkerLoadOptions {
  createRuntime: (plugin: { name: string; file: string }) => Promise<RuntimeHandle>;
}

type WorkerAwareLoadPlugins = (directory: string, options?: WorkerLoadOptions) => Promise<PluginLoadSummary>;

async function loadRegistryModule(): Promise<RegistryModule> {
  try {
    const module = await import('../../src/mcp-builder/plugin-runtime-registry.js') as RegistryModule;
    if (!module.createPluginRuntimeRegistry) {
      assert.fail('plugin-runtime-registry must export createPluginRuntimeRegistry before worker admission');
    }
    return module;
  } catch (error) {
    if (isExactMissingModule(error, 'plugin-runtime-registry.js')) {
      assert.fail('plugin-runtime-registry must exist before worker admission contracts can run');
    }
    throw error;
  }
}

function runtimeManifest(
  name: string,
  tools: PluginRuntimeToolManifest[] = [tool('count')],
): PluginRuntimeManifest {
  return { v: 1, name, version: '1.0.0', description: `${name} runtime`, tools };
}

function tool(
  name: string,
  security: PluginRuntimeSecurity = { category: 'read' },
): PluginRuntimeToolManifest {
  return {
    name,
    description: `${name} behavior`,
    inputSchema: { type: 'object', properties: {} },
    security,
  };
}

function invalidRuntimeManifest(name: string, tools: InvalidRuntimeTool[]): InvalidRuntimeManifest {
  return { v: 1, name, version: '1.0.0', description: `${name} runtime`, tools };
}

function missingSecurityTool(name: string): InvalidRuntimeTool {
  return {
    name,
    description: `${name} behavior`,
    inputSchema: { type: 'object', properties: {} },
  };
}

function invalidCategoryTool(name: string): InvalidRuntimeTool {
  return {
    name,
    description: `${name} behavior`,
    inputSchema: { type: 'object', properties: {} },
    security: { category: 'unsupported-category' },
  };
}

function controlledRuntime(
  calls: string[],
  result: (toolName: string, args: Record<string, unknown>) => Promise<unknown> = async () => undefined,
): RuntimeHandle {
  return {
    identity: {},
    invoke: async (toolName, args) => {
      calls.push(`invoke:${toolName}`);
      return result(toolName, args);
    },
    close: async () => { calls.push('close'); },
  };
}

async function createPluginDirectory(): Promise<{ directory: string; marker: string }> {
  const directory = join(tmpdir(), `plugin-runtime-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const marker = join(directory, 'imported.marker');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'legacy.mcp-server.js'), `
    import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(marker)}, 'imported');
    export default {
      name: 'legacy', version: '1.0.0', description: 'legacy plugin', resources: [], prompts: [],
      tools: [{ name: 'legacy_count', description: 'legacy count', inputSchema: { type: 'object', properties: {} }, security: { category: 'read' }, handler: async () => ({ content: [] }) }]
    };
  `, 'utf8');
  return { directory, marker };
}

describe('plugin runtime registry RED contracts', () => {
  it('keeps loadPlugins(directory) legacy while a disabled outer gate creates neither worker nor import side effect', async () => {
    const fixture = await createPluginDirectory();
    try {
      await withEnvironment({ MCP_DYNAMIC_SERVERS: undefined, MCP_PLUGIN_RUNTIME_MODE: undefined }, async () => {
        const legacy = await loadPlugins(fixture.directory);
        assert.equal(legacy.loaded.length, 1, 'the one-argument loader remains the legacy path');
      });
      await rm(fixture.marker, { force: true });

      await withEnvironment({ MCP_DYNAMIC_SERVERS: 'false', MCP_PLUGIN_RUNTIME_MODE: 'worker' }, async () => {
        let workerFactoryCalls = 0;
        const result = await (loadPlugins as WorkerAwareLoadPlugins)(fixture.directory, {
          createRuntime: async () => {
            workerFactoryCalls += 1;
            return controlledRuntime([]);
          },
        });
        assert.deepEqual(result, { loaded: [], skipped: [], errors: [] }, 'gate-off loading must be a no-op');
        assert.equal(workerFactoryCalls, 0, 'the disabled gate must not construct workers');
        assert.equal(existsSync(fixture.marker), false, 'the disabled gate must not import plugin code');
      });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it('refuses explicit worker mode without compatibility evidence before worker factory or plugin import', async () => {
    const fixture = await createPluginDirectory();
    try {
      await withEnvironment({
        MCP_DYNAMIC_SERVERS: 'true',
        MCP_PLUGIN_RUNTIME_MODE: 'worker',
        MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST: undefined,
      }, async () => {
        let workerFactoryCalls = 0;
        await assert.rejects(
          () => (loadPlugins as WorkerAwareLoadPlugins)(fixture.directory, {
            createRuntime: async () => {
              workerFactoryCalls += 1;
              return controlledRuntime([]);
            },
          }),
          (error: unknown) => typeof error === 'object' && error !== null
            && (error as { code?: unknown }).code === 'COMPATIBILITY_UNESTABLISHED',
        );
        assert.equal(workerFactoryCalls, 0, 'compatibility rejection precedes factory construction');
        assert.equal(existsSync(fixture.marker), false, 'compatibility rejection precedes import side effects');
      });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it('makes invocation unavailable before admission and transfers a runtime handle exactly once', async () => {
    const module = await loadRegistryModule();
    const registry = module.createPluginRuntimeRegistry!();
    const calls: string[] = [];
    const runtime = controlledRuntime(calls, async () => 1);
    const candidate: RuntimeCandidate = {
      filename: 'counter.mcp-server.js',
      manifest: runtimeManifest('counter'),
      handle: runtime,
    };

    try {
      await assert.rejects(() => registry.invoke('count', {}), /admit|unavailable|quarantined/i);
      await registry.admit(candidate);
      assert.equal(await registry.invoke('count', {}), 1, 'admission exposes an owned worker proxy');
      assert.deepEqual(calls, ['invoke:count']);

      await assert.rejects(() => registry.admit(candidate), /transfer|owned|admit|duplicate/i);
      assert.deepEqual(calls, ['invoke:count'], 'a repeated transfer fails before a duplicate invocation');
    } finally {
      await registry.closeAll();
    }
    assert.deepEqual(calls, ['invoke:count', 'close']);
  });

  it('rejects built-in, same-plugin, cross-plugin, filename-identity, and missing-security candidates after awaited cleanup without harming a healthy sibling', async () => {
    const module = await loadRegistryModule();
    const registry = module.createPluginRuntimeRegistry!();
    const healthyCalls: string[] = [];
    const healthy = controlledRuntime(healthyCalls, async () => 2);
    let registryClosed = false;
    try {
      await registry.admit({ filename: 'healthy.mcp-server.js', manifest: runtimeManifest('healthy', [tool('healthy_count')]), handle: healthy });

      const builtInName = TOOLS[0]!.name;
      const invalidCandidates: RuntimeCandidate[] = [
        { filename: 'builtin.mcp-server.js', manifest: runtimeManifest('builtin', [tool(builtInName)]), handle: controlledRuntime([]) },
        { filename: 'same.mcp-server.js', manifest: runtimeManifest('same', [tool('same_count'), tool('same_count')]), handle: controlledRuntime([]) },
        { filename: 'second.mcp-server.js', manifest: runtimeManifest('second', [tool('healthy_count')]), handle: controlledRuntime([]) },
        { filename: 'filename.mcp-server.js', manifest: runtimeManifest('other_name'), handle: controlledRuntime([]) },
        { filename: 'security.mcp-server.js', manifest: invalidRuntimeManifest('security', [missingSecurityTool('unsafe_count')]), handle: controlledRuntime([]) },
        { filename: 'invalid-security.mcp-server.js', manifest: invalidRuntimeManifest('invalid_security', [invalidCategoryTool('invalid_count')]), handle: controlledRuntime([]) },
      ];

      for (const candidate of invalidCandidates) {
        const cleanup = deferred<void>();
        let cleanupReleased = false;
        const calls: string[] = [];
        const delayedCandidate: RuntimeCandidate = {
          ...candidate,
          handle: {
            ...candidate.handle,
            close: async () => {
              calls.push('close:start');
              await cleanup.promise;
              calls.push('close:end');
            },
          },
        };
        let settled = false;
        const admission = registry.admit(delayedCandidate).finally(() => { settled = true; });
        void admission.catch(() => undefined);
        try {
          await Promise.resolve();
          assert.deepEqual(calls, ['close:start'], `${candidate.filename} must begin rejected-runtime cleanup`);
          assert.equal(settled, false, `${candidate.filename} admission must await cleanup completion`);
          cleanup.resolve();
          cleanupReleased = true;
          await assert.rejects(admission, /collision|identity|security|duplicate|reject/i);
          assert.deepEqual(calls, ['close:start', 'close:end'], `${candidate.filename} cleanup must complete once`);
          assert.equal(await registry.invoke('healthy_count', {}), 2, `${candidate.filename} must not disturb a healthy sibling`);
        } finally {
          if (!cleanupReleased) cleanup.resolve();
        }
      }
      await registry.closeAll();
      registryClosed = true;
    } finally {
      if (!registryClosed) await registry.closeAll();
    }
    assert.deepEqual(healthyCalls, ['invoke:healthy_count', 'invoke:healthy_count', 'invoke:healthy_count', 'invoke:healthy_count', 'invoke:healthy_count', 'invoke:healthy_count', 'close']);
  });

  it('preserves a host-owned observational timeout error without closing or quarantining the controlled proxy', async () => {
    const module = await loadRegistryModule();
    const registry = module.createPluginRuntimeRegistry!();
    const HOST_RUNTIME_ERROR = { INVOCATION_TIMEOUT: 'INVOCATION_TIMEOUT' } as const;
    const timeout = Object.assign(new Error(HOST_RUNTIME_ERROR.INVOCATION_TIMEOUT), {
      code: HOST_RUNTIME_ERROR.INVOCATION_TIMEOUT,
    });
    const calls: string[] = [];
    let invocations = 0;
    const runtime: RuntimeHandle = {
      identity: {},
      invoke: async (toolName, args) => {
        calls.push(`invoke:${toolName}`);
        invocations += 1;
        if (args['slow'] === true) throw timeout;
        return invocations;
      },
      close: async () => { calls.push('close'); },
    };

    try {
      await registry.admit({ filename: 'timeout.mcp-server.js', manifest: runtimeManifest('timeout'), handle: runtime });
      const timedOut = registry.invoke('count', { slow: true });
      void timedOut.catch(() => undefined);
      await assert.rejects(timedOut, (error: unknown) => {
        assert.strictEqual(error, timeout, 'the proxy must preserve the exact host timeout error identity');
        return true;
      });
      assert.deepEqual(calls, ['invoke:count'], 'the proxy must not close the worker after a host-owned timeout');
      assert.equal(await registry.invoke('count', { slow: false }), 2, 'the same admitted closure remains callable and is not legacy-quarantined');
    } finally {
      await registry.closeAll();
    }
  });
  it('uses configured worker invocation timeout and keeps a healthy sibling after rejected loader admission', async () => {
    const fixture = await createPluginDirectory();
    const expectedHash = 'a'.repeat(64);
    const expectedDigest = 'b'.repeat(64);
    const calls: string[] = [];
    let constructedTimeout: number | undefined;
    try {
      await writeFile(join(fixture.directory, 'broken.mcp-server.js'), 'export default {};', 'utf8');
      await withEnvironment({
        MCP_DYNAMIC_SERVERS: 'true', MCP_PLUGIN_RUNTIME_MODE: 'worker', MCP_PLUGIN_RUNTIME_COMPATIBILITY_MANIFEST: undefined,
        MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST: JSON.stringify({ nodeMajor: Number(process.versions.node.split('.')[0]), platform: process.platform, arch: process.arch, workerEntryHash: expectedHash, installedPluginDigest: expectedDigest }),
        MCP_PLUGIN_TOOL_TIMEOUT_MS: '37',
      }, async () => {
        const registry = createPluginRuntimeRegistry();
        const result = await loadWorkerPlugins(fixture.directory, registry, {
          observeWorkerEntry: async () => ({ entry: new URL('file:///fixture-worker.js'), hash: expectedHash }),
          observeInstalledPluginDigest: async () => expectedDigest,
          createRuntime: (options) => {
            constructedTimeout = options.invocationTimeoutMs;
            const broken = options.pluginUrl?.includes('broken.mcp-server.js') ?? false;
            const name = broken ? 'broken' : 'legacy';
            return {
              start: async () => broken
                ? runtimeManifest('wrong-name', [tool('broken_count')])
                : runtimeManifest('legacy', [tool('healthy_count')]),
              invoke: async () => 3,
              shutdown: async () => { calls.push(`close:${name}`); },
            };
          },
        });
        assert.equal(constructedTimeout, 37);
        assert.equal(result.loaded.length, 1);
        assert.equal(result.errors.length, 1, 'rejected worker is summarized without aborting healthy sibling admission');
        assert.deepEqual(calls, ['close:broken']);
        assert.equal(await registry.invoke('healthy_count', {}), 3);
        await registry.closeAll();
        assert.deepEqual(calls, ['close:broken', 'close:legacy']);
      });
    } finally { await rm(fixture.directory, { recursive: true, force: true }); }
  });

});
