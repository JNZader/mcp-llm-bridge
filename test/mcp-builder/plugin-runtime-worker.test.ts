import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { PluginRuntimeHost, PluginRuntimeHostError } from '../../src/mcp-builder/plugin-runtime-host.js';
import { emitPluginRuntimeWorker } from './fixtures/plugin-runtime/emit-runtime-worker.js';

interface RuntimeFixture {
  directory: string;
  workerEntry: URL;
  pluginUrl: string;
}

function createRuntimeFixture(source: string): RuntimeFixture {
  const directory = mkdtempSync(join(tmpdir(), 'plugin-runtime-worker-'));
  const plugin = join(directory, 'plugin.mjs');
  writeFileSync(plugin, source, 'utf8');
  return { directory, workerEntry: emitPluginRuntimeWorker(directory), pluginUrl: pathToFileURL(plugin).href };
}

function createHost(fixture: RuntimeFixture, environment: Record<string, string> = {}): PluginRuntimeHost {
  return new PluginRuntimeHost({
    workerEntry: fixture.workerEntry,
    pluginUrl: fixture.pluginUrl,
    environment,
    importTimeoutMs: 300,
    invocationTimeoutMs: 300,
  });
}

function removeFixture(fixture: RuntimeFixture): void {
  rmSync(fixture.directory, { recursive: true, force: true });
}

function failAfter<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([promise, new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('worker did not become ready')), milliseconds);
  })]).finally(() => { if (timer) clearTimeout(timer); });
}

const statefulPlugin = `
let count = 0;
export default {
  name: 'demo_plugin', version: '1', description: 'demo', resources: [], prompts: [],
  tools: [{ name: 'count', description: 'count', inputSchema: {}, security: { category: 'read' }, handler: async () => ++count }]
};
`;

describe('plugin runtime worker', () => {
  it('runs the emitted ESM entry once, retains closures, and never inherits host Node flags', async () => {
    const fixture = createRuntimeFixture(statefulPlugin);
    const host = createHost(fixture, { ALLOWED_SENTINEL: 'visible' });

    try {
      const manifest = await failAfter(host.start(), 500);
      assert.deepEqual(manifest.tools.map((tool) => Object.keys(tool).sort()), [['description', 'inputSchema', 'name', 'security']]);
      assert.equal(await host.invoke('count', {}), 1);
      assert.equal(await host.invoke('count', {}), 2);
      assert.equal(await host.invoke('count', {}), 3);
      assert.equal(host.state, 'active');
      await host.shutdown();
    } finally {
      await host.shutdown().catch(() => undefined);
      removeFixture(fixture);
    }
  });

  it('returns correlated stable failures for malformed RPC without running the handler', async () => {
    const fixture = createRuntimeFixture(`
let calls = 0;
export default {
  name: 'malformed_plugin', version: '1', description: 'malformed', resources: [], prompts: [],
  tools: [{ name: 'calls', description: 'calls', inputSchema: {}, security: { category: 'read' }, handler: async () => ++calls }]
};`);
    const host = createHost(fixture);

    try {
      await failAfter(host.start(), 500);
      const failure = new Promise<unknown>((resolve) => host.worker.once('message', resolve));
      host.worker.postMessage({ v: 1, kind: 'invoke', id: 'malformed-1', tool: 'calls', args: {}, extra: true });
      assert.deepEqual(await failAfter(failure, 500), {
        v: 1, kind: 'failure', id: 'malformed-1', code: 'PROTOCOL_INVALID',
      });
      assert.equal(await host.invoke('calls', {}), 1);
      await host.shutdown();
    } finally {
      await host.shutdown().catch(() => undefined);
      removeFixture(fixture);
    }
  });

  it('returns one observational timeout, ignores the matching late result, and keeps the same worker closure alive', async () => {
    const fixture = createRuntimeFixture(`
let count = 0;
export default {
  name: 'slow_plugin', version: '1', description: 'slow', resources: [], prompts: [],
  tools: [{ name: 'count', description: 'count', inputSchema: {}, security: { category: 'read' }, handler: async (args) => {
    count += 1;
    if (args.slow) await new Promise((resolve) => setTimeout(resolve, 40));
    return count;
  }}]
};`);
    const host = createHost(fixture);
    host.setInvocationTimeout(10);

    try {
      await failAfter(host.start(), 500);
      const timedOut = host.invoke('count', { slow: true });
      await assert.rejects(timedOut, (error: unknown) => error instanceof PluginRuntimeHostError && error.code === 'INVOCATION_TIMEOUT');
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(await host.invoke('count', { slow: false }), 2);
      assert.equal(host.state, 'active');
      await host.shutdown();
    } finally {
      await host.shutdown().catch(() => undefined);
      removeFixture(fixture);
    }
  });

  it('rejects startup only after a timed-out real import has observed worker exit', async () => {
    const fixture = createRuntimeFixture(`setInterval(() => {}, 1000); await new Promise(() => {}); export default {};`);
    const host = createHost(fixture);
    host.setImportTimeout(10);

    try {
      await assert.rejects(failAfter(host.start(), 500), (error: unknown) => error instanceof PluginRuntimeHostError && error.code === 'IMPORT_TIMEOUT');
      assert.equal(host.state, 'quarantined');
    } finally {
      await host.shutdown().catch(() => undefined);
      removeFixture(fixture);
    }
  });

  it('quarantines one failed worker and settles its pending calls once without disturbing a sibling', async () => {
    const failedFixture = createRuntimeFixture(`
export default {
  name: 'failed_plugin', version: '1', description: 'failed', resources: [], prompts: [],
  tools: [
    { name: 'hold', description: 'hold', inputSchema: {}, security: { category: 'read' }, handler: async () => new Promise(() => {}) },
    { name: 'crash', description: 'crash', inputSchema: {}, security: { category: 'read' }, handler: async () => process.exit(1) }
  ]
};`);
    const healthyFixture = createRuntimeFixture(statefulPlugin);
    const failed = createHost(failedFixture);
    const healthy = createHost(healthyFixture);

    try {
      await Promise.all([failAfter(failed.start(), 500), failAfter(healthy.start(), 500)]);
      const held = failed.invoke('hold', {});
      const crashed = failed.invoke('crash', {});
      await assert.rejects(held, (error: unknown) => error instanceof PluginRuntimeHostError && error.code === 'WORKER_EXITED');
      await assert.rejects(crashed, (error: unknown) => error instanceof PluginRuntimeHostError && error.code === 'WORKER_EXITED');
      assert.equal(failed.state, 'quarantined');
      assert.equal(await healthy.invoke('count', {}), 1);
      assert.equal(await healthy.invoke('count', {}), 2);
    } finally {
      await Promise.all([failed.shutdown().catch(() => undefined), healthy.shutdown().catch(() => undefined)]);
      removeFixture(failedFixture);
      removeFixture(healthyFixture);
    }
  });
});
