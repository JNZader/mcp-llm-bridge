import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { PluginRuntimeHost, PluginRuntimeHostError, type WorkerLike } from '../../src/mcp-builder/plugin-runtime-host.js';
import { emitPluginRuntimeWorker } from './fixtures/plugin-runtime/emit-runtime-worker.js';

function emittedWorker(): { directory: string; entry: URL; pluginUrl: string } {
  const directory = mkdtempSync(join(tmpdir(), 'plugin-runtime-diagnostics-'));
  const plugin = join(directory, 'plugin.mjs');
  writeFileSync(plugin, `
const write = (stream, bytes) => new Promise((resolve, reject) => {
  stream.write(bytes, (error) => error ? reject(error) : resolve());
});
export default {
  name: 'noisy_plugin', version: '1', description: 'noisy', resources: [], prompts: [],
  tools: [{ name: 'noise', description: 'noise', inputSchema: {}, security: { category: 'read' }, handler: async () => {
    for (const stream of [process.stdout, process.stderr]) {
      for (let index = 0; index < 16; index += 1) {
        await write(stream, 'é'.repeat(16 * 1024));
      }
    }
    return 'ok';
  }}]
};`, 'utf8');
  return { directory, entry: emitPluginRuntimeWorker(directory), pluginUrl: pathToFileURL(plugin).href };
}

class ControlledWorker extends EventEmitter implements WorkerLike {
  readonly posted: unknown[] = [];
  terminated = 0;
  postMessage(value: unknown): void { this.posted.push(value); }
  async terminate(): Promise<number> { this.terminated += 1; return 1; }
}

describe('plugin runtime diagnostics and terminal lifecycle', () => {
  it('shares one 64 KiB lifetime budget across controlled stdout and stderr captures', async () => {
    const worker = new ControlledWorker();
    let eventCount = 0;
    let projectedBytes = 0;
    const host = new PluginRuntimeHost({ worker, onDiagnostic: (event) => {
      eventCount += 1;
      projectedBytes += Buffer.byteLength(event.text, 'utf8');
      assert.ok(Buffer.byteLength(event.text, 'utf8') <= 8 * 1024);
    } });
    const chunk = Buffer.alloc(8 * 1024, 'x');

    try {
      for (let index = 0; index < 8; index += 1) {
        host.capture(index % 2 === 0 ? 'stdout' : 'stderr', chunk);
      }
      assert.equal(eventCount, 8);
      assert.equal(projectedBytes, 64 * 1024);
      host.capture('stdout', chunk);
      assert.equal(eventCount, 8, 'the ninth chunk must not emit past the shared lifetime budget');
      assert.equal(host.diagnosticCounters.stdout.emittedBytes, 32 * 1024);
      assert.equal(host.diagnosticCounters.stderr.emittedBytes, 32 * 1024);
      assert.equal(host.diagnosticCounters.stdout.droppedBytes, chunk.length);
      host.capture('stderr', chunk);
      assert.equal(host.diagnosticCounters.stderr.droppedBytes, chunk.length);
      assert.equal(eventCount, 8, 'either exhausted stream must drain without another callback');
      assert.equal(projectedBytes, 64 * 1024);
    } finally {
      // This controlled worker never emits exit on terminate; explicitly acknowledge exit
      // before shutdown so the test removes host listeners without waiting forever.
      worker.emit('exit', 0);
      await host.shutdown();
      assert.equal(worker.listenerCount('message'), 0);
      assert.equal(worker.listenerCount('error'), 0);
      assert.equal(worker.listenerCount('exit'), 0);
    }
  });

  it('bounds real worker events and the shared lifetime while draining both streams', async () => {
    const fixture = emittedWorker();
    const projection = { events: 0, bytes: 0, oversized: false, invalidUtf8: false, truncated: false };
    const host = new PluginRuntimeHost({
      workerEntry: fixture.entry,
      pluginUrl: fixture.pluginUrl,
      environment: {},
      importTimeoutMs: 1_000,
      invocationTimeoutMs: 1_000,
      onDiagnostic: (event) => {
        const bytes = Buffer.byteLength(event.text, 'utf8');
        projection.events += 1;
        projection.bytes += bytes;
        projection.oversized ||= bytes > 8 * 1024;
        projection.invalidUtf8 ||= event.text.includes('\uFFFD');
        projection.truncated ||= event.truncated;
      },
    });

    try {
      await host.start();
      // The fixture awaits each write callback before its RPC result; no sleep or
      // wait for a diagnostic callback from an already exhausted stream is needed.
      assert.equal(await host.invoke('noise', {}), 'ok');
      assert.ok(projection.events > 0);
      assert.equal(projection.oversized, false);
      assert.equal(projection.invalidUtf8, false);
      assert.equal(projection.truncated, true);
      for (const stream of ['stdout', 'stderr'] as const) {
        const counters = host.diagnosticCounters[stream];
        assert.ok(counters.droppedBytes > 0);
        assert.equal(counters.emittedBytes + counters.droppedBytes, 512 * 1024, 'all bytes must be drained and accounted for, including a stream with zero diagnostic events');
      }
      const totalDiagnosticBytes = host.diagnosticCounters.stdout.emittedBytes + host.diagnosticCounters.stderr.emittedBytes;
      assert.ok(totalDiagnosticBytes <= 64 * 1024, 'one worker lifetime must bound combined stdout and stderr diagnostics to 64 KiB');
      assert.equal(projection.bytes, totalDiagnosticBytes);
      await host.shutdown();
    } finally {
      await host.shutdown().catch(() => undefined);
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it('keeps startup pending through an intermediate error and settles import timeout exactly once on observed exit', async () => {
    const worker = new ControlledWorker();
    const host = new PluginRuntimeHost({ worker, importTimeoutMs: 5 });
    const start = host.start();

    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(worker.terminated, 1);
    worker.emit('error', new Error('intermediate'));
    let settled = false;
    void start.finally(() => { settled = true; }).catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    worker.emit('exit', 1);
    await assert.rejects(start, (error: unknown) => error instanceof PluginRuntimeHostError && error.code === 'IMPORT_TIMEOUT');
    worker.emit('message', { v: 1, kind: 'ready', manifest: { v: 1, name: 'late_plugin', version: '1', description: 'late', tools: [] } });
    worker.emit('exit', 1);
    assert.equal(host.state, 'quarantined');
  });
});
