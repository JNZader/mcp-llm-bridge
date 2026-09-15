import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';

import { Router } from '../../src/core/router.js';

import { startDefaultMcpMode, buildMcpServerDeps, type ServerStartupDeps, type ServerStartupRuntime } from '../../src/bootstrap/server-startup.js';
import { setupGracefulShutdown, type ShutdownDeps } from '../../src/bootstrap/shutdown.js';
import { startMcpServer, type StartMcpServerOptions } from '../../src/server/mcp-server.js';
import { PluginRuntimeRegistry } from '../../src/mcp-builder/plugin-runtime-registry.js';
import { freezeRouterForStartup } from '../helpers/frozen-router.js';
import { deferred, withEnvironment } from '../mcp-builder/fixtures/plugin-runtime/unit3-harness.js';

function runtimeStub(registry: PluginRuntimeRegistry): ServerStartupRuntime {
  return {
    router: {} as ServerStartupRuntime['router'],
    vault: {} as ServerStartupRuntime['vault'],
    config: { securityProfile: 'local-dev' } as ServerStartupRuntime['config'],
    groupStore: {} as ServerStartupRuntime['groupStore'],
    costTracker: {} as ServerStartupRuntime['costTracker'],
    latencyMeasurer: {} as ServerStartupRuntime['latencyMeasurer'],
    freeModelRouter: {} as ServerStartupRuntime['freeModelRouter'],
    db: {} as ServerStartupRuntime['db'],
    analyticsAggregator: {} as ServerStartupRuntime['analyticsAggregator'],
    comparisonService: {} as ServerStartupRuntime['comparisonService'],
    approvalStore: {} as ServerStartupRuntime['approvalStore'],
    sessionManager: {} as ServerStartupRuntime['sessionManager'],
    requestLogger: {} as ServerStartupRuntime['requestLogger'],
    bridge: null,
    codeSearch: {} as ServerStartupRuntime['codeSearch'],
    stateManager: {} as ServerStartupRuntime['stateManager'],
    pageIndexTools: {} as ServerStartupRuntime['pageIndexTools'],
    pluginRuntimeRegistry: registry,
  };
}

function delayedRegistryClose(
  registry: PluginRuntimeRegistry,
  closeAll: () => Promise<void>,
) {
  return mock.method(registry, 'closeAll', closeAll);
}

function inertMcpServerOptions(registry?: StartMcpServerOptions['pluginRuntimeRegistry']): StartMcpServerOptions {
  const options: StartMcpServerOptions = {
    router: freezeRouterForStartup(new Router()),
    vault: {} as StartMcpServerOptions['vault'],
    handleToolCall: async () => ({ content: [] }),
  };
  if (registry) options.pluginRuntimeRegistry = registry;
  return options;
}

async function startInertMcpServer(registry?: StartMcpServerOptions['pluginRuntimeRegistry']) {
  return withEnvironment(
    { MCP_DYNAMIC_SERVERS: 'false' },
    () => startMcpServer(inertMcpServerOptions(registry)),
  );
}


describe('plugin runtime lifecycle RED contracts', () => {
  it('propagates the exact registry owner through MCP dependencies rather than a truthy replacement', () => {
    const registry = new PluginRuntimeRegistry();
    const dependencies = buildMcpServerDeps(runtimeStub(registry));
    assert.strictEqual(dependencies.pluginRuntimeRegistry, registry, 'MCP startup must receive the same registry identity owned by RuntimeContext');
  });

  it('awaits retained registry exit acknowledgement when MCP startup or connection rejects', async () => {
    const events: string[] = [];
    const exitAcknowledged = deferred<void>();
    const registry = new PluginRuntimeRegistry();
    const registryCloseMock = delayedRegistryClose(registry, async () => {
      events.push('registry.close:start');
      await exitAcknowledged.promise;
      events.push('registry.close:end');
    });
    const deps: ServerStartupDeps = {
      startHttpServerWithDeps: (..._args) => {
        throw new Error('HTTP server must not start in MCP connection failure coverage.');
      },
      startMcpServer: async () => {
        events.push('mcp.connect');
        throw new Error('connect failed');
      },
    };
    let settled = false;
    let exitReleased = false;
    const startup = startDefaultMcpMode(runtimeStub(registry), deps).finally(() => { settled = true; });
    void startup.catch(() => undefined);

    try {
      await Promise.resolve();
      assert.deepEqual(events, ['mcp.connect', 'registry.close:start'], 'connection failure must begin retained-runtime cleanup');
      assert.equal(settled, false, 'startup cannot settle before controlled worker exits acknowledge');
      exitAcknowledged.resolve();
      exitReleased = true;
      await assert.rejects(startup, /connect failed/);
      assert.deepEqual(events, ['mcp.connect', 'registry.close:start', 'registry.close:end']);
    } finally {
      if (!exitReleased) exitAcknowledged.resolve();
      registryCloseMock.mock.restore();
    }
  });

  it('closes the registry before services and exactly once across repeated shutdown signals', async () => {
    const events: string[] = [];
    const listeners = new Map<string, () => void | Promise<void>>();
    const exitAcknowledged = deferred<void>();
    const registry = new PluginRuntimeRegistry();
    const registryCloseMock = delayedRegistryClose(registry, async () => {
      events.push('registry.close:start');
      await exitAcknowledged.promise;
      events.push('registry.close:end');
    });
    const shutdownDeps: ShutdownDeps = {
      pluginRuntimeRegistry: registry,
      compressor: { destroy: () => { events.push('compressor.destroy'); } },
      latencyMeasurer: { stopBackgroundTask: () => { events.push('latency.stop'); } },
      freeModelRouter: { destroy: () => { events.push('router.destroy'); } },
      costTracker: { destroy: () => { events.push('cost.destroy'); } },
      analyticsAggregator: { destroy: () => { events.push('analytics.destroy'); } },
      groupStore: { close: () => { events.push('groups.close'); } },
      sessionManager: { destroy: () => { events.push('sessions.destroy'); } },
      vault: { destroy: () => { events.push('vault.destroy'); } },
      cleanupAllProviderHomes: () => { events.push('homes.cleanup'); },
      shutdownTracing: async () => { events.push('tracing.shutdown'); },
      processOn: (signal: string, listener: () => void | Promise<void>) => listeners.set(signal, listener),
      processExit: () => { events.push('process.exit'); },
    };
    await setupGracefulShutdown(shutdownDeps);

    const first = listeners.get('SIGINT')!();
    const second = listeners.get('SIGTERM')!();
    const shutdowns = Promise.all([first, second]);
    void shutdowns.catch(() => undefined);
    let exitReleased = false;
    try {
      await Promise.resolve();
      assert.deepEqual(events, ['registry.close:start'], 'registry shutdown begins before all service teardown');
      exitAcknowledged.resolve();
      exitReleased = true;
      await shutdowns;
      assert.deepEqual(events, [
        'registry.close:start', 'registry.close:end', 'compressor.destroy', 'latency.stop', 'router.destroy',
        'cost.destroy', 'analytics.destroy', 'groups.close', 'sessions.destroy', 'homes.cleanup', 'vault.destroy',
        'tracing.shutdown', 'process.exit',
      ]);
    } finally {
      if (!exitReleased) exitAcknowledged.resolve();
      registryCloseMock.mock.restore();
    }
  });

  it('awaits an injected registry close exactly once before the original SDK close', async () => {
    const events: string[] = [];
    const registryCloseAcknowledged = deferred<void>();
    const registryCloseStarted = deferred<void>();
    let registryCloseReleased = false;
    const registry = new PluginRuntimeRegistry();
    const registryCloseMock = delayedRegistryClose(registry, async () => {
      events.push('injected.registry.close:start');
      registryCloseStarted.resolve();
      await registryCloseAcknowledged.promise;
      events.push('injected.registry.close:end');
    });
    const connectMock = mock.method(Server.prototype, 'connect', async () => {
      events.push('sdk.connect');
    });
    const closeMock = mock.method(Server.prototype, 'close', async () => {
      events.push('sdk.close');
    });

    try {
      const server = await startInertMcpServer(registry);
      const firstClose = server.close();
      const secondClose = server.close();

      await registryCloseStarted.promise;
      assert.deepEqual(events, ['sdk.connect', 'injected.registry.close:start']);

      registryCloseAcknowledged.resolve();
      registryCloseReleased = true;
      await Promise.all([firstClose, secondClose]);

      assert.deepEqual(events, [
        'sdk.connect',
        'injected.registry.close:start',
        'injected.registry.close:end',
        'sdk.close',
      ]);
    } finally {
      if (!registryCloseReleased) registryCloseAcknowledged.resolve();
      closeMock.mock.restore();
      connectMock.mock.restore();
      registryCloseMock.mock.restore();
    }
  });

  it('awaits a fallback registry close exactly once before the original SDK close', async () => {
    const events: string[] = [];
    const registryCloseAcknowledged = deferred<void>();
    const registryCloseStarted = deferred<void>();
    let registryCloseReleased = false;
    const fallbackRegistryCloseMock = mock.method(PluginRuntimeRegistry.prototype, 'closeAll', async () => {
      events.push('fallback.registry.close:start');
      registryCloseStarted.resolve();
      await registryCloseAcknowledged.promise;
      events.push('fallback.registry.close:end');
    });
    const connectMock = mock.method(Server.prototype, 'connect', async () => {
      events.push('sdk.connect');
    });
    const closeMock = mock.method(Server.prototype, 'close', async () => {
      events.push('sdk.close');
    });

    try {
      const server = await startInertMcpServer();
      const firstClose = server.close();
      const secondClose = server.close();

      await registryCloseStarted.promise;
      assert.deepEqual(events, ['sdk.connect', 'fallback.registry.close:start']);

      registryCloseAcknowledged.resolve();
      registryCloseReleased = true;
      await Promise.all([firstClose, secondClose]);

      assert.deepEqual(events, [
        'sdk.connect',
        'fallback.registry.close:start',
        'fallback.registry.close:end',
        'sdk.close',
      ]);
    } finally {
      if (!registryCloseReleased) registryCloseAcknowledged.resolve();
      closeMock.mock.restore();
      connectMock.mock.restore();
      fallbackRegistryCloseMock.mock.restore();
    }
  });

  it('awaits injected registry cleanup before surfacing a rejected SDK connection', async () => {
    const events: string[] = [];
    const registryCloseAcknowledged = deferred<void>();
    const registryCloseStarted = deferred<void>();
    let registryCloseReleased = false;
    const registry = new PluginRuntimeRegistry();
    const registryCloseMock = delayedRegistryClose(registry, async () => {
      events.push('injected.registry.close:start');
      registryCloseStarted.resolve();
      await registryCloseAcknowledged.promise;
      events.push('injected.registry.close:end');
    });
    const connectMock = mock.method(Server.prototype, 'connect', async () => {
      events.push('sdk.connect');
      throw new Error('sdk connect rejected');
    });
    const startup = startInertMcpServer(registry);
    void startup.catch(() => undefined);

    try {
      await registryCloseStarted.promise;
      assert.deepEqual(events, ['sdk.connect', 'injected.registry.close:start']);

      registryCloseAcknowledged.resolve();
      registryCloseReleased = true;
      await assert.rejects(startup, /sdk connect rejected/);
      assert.deepEqual(events, [
        'sdk.connect',
        'injected.registry.close:start',
        'injected.registry.close:end',
      ]);
    } finally {
      if (!registryCloseReleased) registryCloseAcknowledged.resolve();
      connectMock.mock.restore();
      registryCloseMock.mock.restore();
    }
  });

});
