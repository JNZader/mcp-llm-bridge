import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import { PluginRuntimeConfigError, pluginRuntimeConfig } from '../../src/core/mcp-runtime-config.js';
import type { DiagnosticStream, PluginRuntimeDiagnosticCounter, PluginRuntimeHostOptions, WorkerLike } from '../../src/mcp-builder/plugin-runtime-host.js';
import { withEnvironment } from '../mcp-builder/fixtures/plugin-runtime/unit3-harness.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('plugin runtime package prequalification contracts', () => {
  it('rejects worker selection with missing compatibility evidence without claiming installed-package qualification', async () => {
    await withEnvironment({
      MCP_DYNAMIC_SERVERS: 'true',
      MCP_PLUGIN_RUNTIME_MODE: 'worker',
      MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST: undefined,
    }, async () => {
      assert.throws(
        () => pluginRuntimeConfig(),
        (error: unknown) => error instanceof PluginRuntimeConfigError && error.code === 'COMPATIBILITY_UNESTABLISHED',
      );
    });
  });

  it('declares an ESM worker source entry and package distribution boundary without treating source inspection as installed-artifact proof', async () => {
    const [tsupConfig, packageText] = await Promise.all([
      readFile(join(repositoryRoot, 'tsup.config.ts'), 'utf8'),
      readFile(join(repositoryRoot, 'package.json'), 'utf8'),
    ]);
    const packageJson = JSON.parse(packageText) as { type?: unknown; main?: unknown; files?: unknown };

    assert.match(tsupConfig, /entry:\s*\{[^}]*['\"]plugin-runtime-worker['\"]:\s*['\"]src\/mcp-builder\/plugin-runtime-worker\.ts['\"]/s);
    assert.match(tsupConfig, /format:\s*\[\s*['"]esm['"]\s*\]/);
    assert.equal(packageJson.type, 'module');
    assert.equal(packageJson.main, 'dist/index.js');
    assert.ok(Array.isArray(packageJson.files) && packageJson.files.includes('dist'), 'the published package boundary must include dist');
  });
});


const installedPackageRoot = process.env['PLUGIN_PACKAGE_ROOT'];
const acceptanceOutput = process.env['PLUGIN_ACCEPTANCE_OUTPUT'];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function installedDigest(root: string): Promise<string> {
  const stat = await lstat(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'installed package root must be a real directory');
  const digest = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('installed qualification rejects symlinks');
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        assert.ok(entry.isFile(), 'installed qualification rejects special files');
        const canonical = relative(root, absolute).split(sep).join('/');
        digest.update(canonical, 'utf8');
        digest.update('\0');
        digest.update(sha256(await readFile(absolute)), 'utf8');
        digest.update('\0');
      }
    }
  };
  await visit(root);
  return digest.digest('hex');
}

async function assertInstalledEntries(root: string): Promise<void> {
  for (const entry of ['dist/loader.js', 'dist/plugin-runtime-host.js', 'dist/plugin-runtime-registry.js', 'dist/plugin-runtime-worker.js']) {
    const stat = await lstat(join(root, entry)).catch(() => undefined);
    assert.ok(stat?.isFile(), `installed package must emit ${entry} before qualification imports`);
  }
}

function compatibilityManifest(workerEntryHash: string, installedPluginDigest: string): string {
  return JSON.stringify({
    nodeMajor: Number(process.versions.node.split('.')[0]),
    platform: process.platform,
    arch: process.arch,
    workerEntryHash,
    installedPluginDigest,
  });
}

interface InstalledHost {
  readonly worker: WorkerLike;
  readonly diagnosticCounters: Record<DiagnosticStream, PluginRuntimeDiagnosticCounter>;
  start(): Promise<unknown>;
  invoke(tool: string, args: Record<string, unknown>): Promise<unknown>;
  shutdown(): Promise<void>;
}

interface InstalledHostModule {
  PluginRuntimeHost: new (options: PluginRuntimeHostOptions) => InstalledHost;
}

interface InstalledRegistry {
  invoke(tool: string, args: Record<string, unknown>): Promise<unknown>;
  closeAll(): Promise<void>;
}

interface InstalledRegistryModule {
  createPluginRuntimeRegistry(): InstalledRegistry;
}

interface InstalledLoaderModule {
  loadWorkerPlugins(root: string, target: InstalledRegistry): Promise<{ loaded: unknown[] }>;
}

interface QualificationResult {
  count: number;
  environment: string[];
  argv: string[];
  execArgv: string[];
}

interface ObservedExit {
  exited: boolean;
  count: number;
  dispose(): void;
}

function observeExit(worker: WorkerLike): ObservedExit {
  const observed: ObservedExit = {
    exited: false,
    count: 0,
    dispose: () => worker.removeListener('exit', onExit),
  };
  const onExit = (): void => {
    observed.exited = true;
    observed.count += 1;
  };
  worker.once('exit', onExit);
  return observed;
}

function assertIsolatedResult(result: unknown, count: number): void {
  const observed = result as QualificationResult;
  assert.equal(observed.count, count);
  assert.deepEqual(observed.environment, []);
  assert.deepEqual(observed.argv, []);
  assert.deepEqual(observed.execArgv, []);
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(() => lstat(path), (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT');
}

if (installedPackageRoot) {
  describe('plugin runtime installed-package qualification', () => {
    it('fails before imports when the installed loader, host, registry, or worker entry is missing', async () => {
      await assertInstalledEntries(installedPackageRoot);
    });

    it('qualifies one frozen built-in-only fixture through raw worker then installed admission before writing acceptance output', async () => {
      await assertInstalledEntries(installedPackageRoot);
      assert.ok(acceptanceOutput, 'PLUGIN_ACCEPTANCE_OUTPUT is required for an observed acceptance artifact');
      const outputPath = resolve(acceptanceOutput);
      await assertMissing(outputPath);

      const fixtureRoot = await mkdtemp(join(tmpdir(), 'plugin-runtime-installed-'));
      const pluginPath = join(fixtureRoot, 'qualified.mcp-server.js');
      const markerPath = `${fixtureRoot}.import-marker`;
      const workerEntry = pathToFileURL(join(installedPackageRoot, 'dist/plugin-runtime-worker.js'));
      const diagnosticProjection = { events: 0, bytes: 0, oversized: false, truncated: false };
      let rawHost: InstalledHost | undefined;
      let hungHost: InstalledHost | undefined;
      let rawExit: ObservedExit | undefined;
      let hungExit: ObservedExit | undefined;
      let registry: InstalledRegistry | undefined;
      const originalWrite = process.stdout.write;
      const sentinel = Buffer.from('UNIT4_RAW_STDOUT_SENTINEL');
      let stdoutTail = Buffer.alloc(0);
      let rawSentinelReachedParent = false;
      process.stdout.write = function (this: typeof process.stdout, ...args: unknown[]): boolean {
        const bytes = typeof args[0] === 'string'
          ? Buffer.from(args[0], typeof args[1] === 'string' ? args[1] as BufferEncoding : 'utf8')
          : args[0] instanceof Uint8Array ? Buffer.from(args[0]) : Buffer.alloc(0);
        const boundary = Buffer.concat([stdoutTail, bytes.subarray(0, sentinel.length - 1)]);
        rawSentinelReachedParent ||= bytes.includes(sentinel) || boundary.includes(sentinel);
        stdoutTail = Buffer.from(bytes.length >= sentinel.length - 1
          ? bytes.subarray(-(sentinel.length - 1))
          : Buffer.concat([stdoutTail, bytes]).subarray(-(sentinel.length - 1)));
        return Reflect.apply(originalWrite, this, args);
      };

      try {
        const outputRelative = relative(fixtureRoot, outputPath);
        assert.ok(outputRelative === '..' || outputRelative.startsWith(`..${sep}`), 'acceptance output must remain outside the digested fixture root');
        const workerEntryHash = sha256(await readFile(fileURLToPath(workerEntry)));
        await writeFile(pluginPath, `
if (process.env.UNIT4_HANG_IMPORT === '1') {
  // Keep the import pending until host termination, rather than idle worker exit.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await new Promise(() => {});
  } finally {
    clearInterval(keepAlive);
  }
}
let count = 0;
const marker = ${JSON.stringify(markerPath)};
import { writeFileSync } from 'node:fs';
writeFileSync(marker, 'imported');
const write = (stream, bytes) => new Promise((resolve, reject) => {
  stream.write(bytes, (error) => error ? reject(error) : resolve());
});
export default {
  name: 'qualified', version: '1', description: 'built-in only installed qualification', resources: [], prompts: [],
  tools: [{ name: 'qualified_count', description: 'retained count', inputSchema: { type: 'object' }, security: { category: 'read' }, handler: async () => {
    count += 1;
    for (let index = 0; index < 32; index += 1) {
      await write(process.stdout, 'x'.repeat(32 * 1024));
      await write(process.stderr, 'y'.repeat(32 * 1024));
    }
    await write(process.stdout, 'UNIT4_RAW_STDOUT_SENTINEL');
    await write(process.stderr, 'UNIT4_RAW_STDERR_SENTINEL');
    return { count, environment: Object.keys(process.env), argv: process.argv.slice(2), execArgv: process.execArgv };
  }}]
};`, 'utf8');

        const fixtureDigest = await installedDigest(fixtureRoot);
        const assertFrozen = async (): Promise<void> => {
          assert.equal(sha256(await readFile(fileURLToPath(workerEntry))), workerEntryHash, 'installed worker entry must retain its original qualified hash');
          assert.equal(await installedDigest(fixtureRoot), fixtureDigest, 'qualification and admission must retain the same frozen fixture bytes');
        };
        const pluginUrl = pathToFileURL(pluginPath).href;
        const hostModule = await import(pathToFileURL(join(installedPackageRoot, 'dist/plugin-runtime-host.js')).href) as InstalledHostModule;
        await withEnvironment({ UNIT4_PARENT_CANARY: 'parent-only' }, async () => {
          // Omitting worker exercises the installed production factory, not a test-created worker.
          rawHost = new hostModule.PluginRuntimeHost({
            workerEntry,
            pluginUrl,
            environment: {},
            importTimeoutMs: 1_000,
            invocationTimeoutMs: 1_000,
            onDiagnostic: (event) => {
              const bytes = Buffer.byteLength(event.text, 'utf8');
              diagnosticProjection.events += 1;
              diagnosticProjection.bytes += bytes;
              diagnosticProjection.oversized ||= bytes > 8 * 1024;
              diagnosticProjection.truncated ||= event.truncated;
            },
          });
          rawExit = observeExit(rawHost.worker);
          await rawHost.start();
          assertIsolatedResult(await rawHost.invoke('qualified_count', {}), 1);
          assertIsolatedResult(await rawHost.invoke('qualified_count', {}), 2);
          // Write callbacks drain both streams before each RPC result, even when a stream's
          // aggregate budget is exhausted and it no longer emits diagnostic callbacks.
          const { stdout, stderr } = rawHost.diagnosticCounters;
          assert.ok(diagnosticProjection.events > 0);
          assert.equal(diagnosticProjection.oversized, false, 'diagnostic events must be at most 8 KiB');
          assert.equal(diagnosticProjection.truncated, true);
          assert.ok(stdout.droppedBytes > 0 && stderr.droppedBytes > 0, 'both streams must account for dropped bytes');
          assert.ok(stdout.emittedBytes + stderr.emittedBytes <= 64 * 1024, 'the host lifetime budget is shared across stdout and stderr');
          assert.equal(diagnosticProjection.bytes, stdout.emittedBytes + stderr.emittedBytes);
          await rawHost.shutdown();
          assert.equal(rawExit.exited, true, 'shutdown must await the real raw worker exit');
          assert.equal(rawExit.count, 1);
        });
        await rm(markerPath, { force: true });
        await assertFrozen();

        hungHost = new hostModule.PluginRuntimeHost({
          workerEntry,
          pluginUrl,
          environment: { UNIT4_HANG_IMPORT: '1' },
          importTimeoutMs: 1_000,
          invocationTimeoutMs: 1_000,
        });
        const observedHungExit = observeExit(hungHost.worker);
        hungExit = observedHungExit;
        // Attach both observers immediately: asserting only after awaiting exit would hide
        // a startup promise that rejected prematurely, before the worker actually exited.
        await hungHost.start().then(
          () => {
            assert.equal(observedHungExit.exited, true, 'startup must not settle before the real worker exit');
            assert.fail('a hung import must reject startup, never fulfill it');
          },
          (error: unknown) => {
            assert.equal(observedHungExit.exited, true, 'IMPORT_TIMEOUT must settle only after the real worker exit');
            assert.equal(observedHungExit.count, 1);
            assert.ok(typeof error === 'object' && error !== null && 'code' in error);
            assert.equal(error.code, 'IMPORT_TIMEOUT');
          },
        );
        await assertMissing(markerPath);
        await assertFrozen();

        const loader = await import(pathToFileURL(join(installedPackageRoot, 'dist/loader.js')).href) as InstalledLoaderModule;
        const registryModule = await import(pathToFileURL(join(installedPackageRoot, 'dist/plugin-runtime-registry.js')).href) as InstalledRegistryModule;
        await assertFrozen();
        const observedManifest = compatibilityManifest(workerEntryHash, fixtureDigest);
        const incompatible = (field: string): string => {
          const tuple = JSON.parse(observedManifest) as Record<string, unknown>;
          if (field === 'nodeMajor') tuple[field] = Number(tuple[field]) + 1;
          else if (field === 'platform') tuple[field] = process.platform === 'linux' ? 'darwin' : 'linux';
          else if (field === 'arch') tuple[field] = process.arch === 'x64' ? 'arm64' : 'x64';
          else tuple[field] = tuple[field] === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);
          return JSON.stringify(tuple);
        };
        for (const manifest of [undefined, ...['nodeMajor', 'platform', 'arch', 'workerEntryHash', 'installedPluginDigest'].map(incompatible)]) {
          await assertMissing(markerPath);
          await assertFrozen();
          await withEnvironment({ MCP_DYNAMIC_SERVERS: 'true', MCP_PLUGIN_RUNTIME_MODE: 'worker', MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST: manifest }, async () => {
            registry = registryModule.createPluginRuntimeRegistry();
            try {
              await assert.rejects(() => loader.loadWorkerPlugins(fixtureRoot, registry!), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'COMPATIBILITY_UNESTABLISHED');
              await assertMissing(markerPath);
            } finally {
              await registry.closeAll();
              registry = undefined;
            }
          });
          await assertFrozen();
        }
        await withEnvironment({ UNIT4_PARENT_CANARY: 'parent-only', MCP_DYNAMIC_SERVERS: 'true', MCP_PLUGIN_RUNTIME_MODE: 'worker', MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST: observedManifest }, async () => {
          registry = registryModule.createPluginRuntimeRegistry();
          try {
            await assertFrozen();
            const summary = await loader.loadWorkerPlugins(fixtureRoot, registry);
            assert.equal(summary.loaded.length, 1);
            assert.equal(await readFile(markerPath, 'utf8'), 'imported');
            assertIsolatedResult(await registry.invoke('qualified_count', {}), 1);
            assertIsolatedResult(await registry.invoke('qualified_count', {}), 2);
          } finally {
            await registry.closeAll();
            registry = undefined;
          }
        });
        await mkdir(dirname(outputPath), { recursive: true });
        await assertFrozen();
        assert.equal(rawSentinelReachedParent, false, 'raw stdout must never reach the actual parent stdout during raw or matching admission');
        await writeFile(outputPath, JSON.stringify({ schema: 'plugin-runtime-acceptance/v1', observed: JSON.parse(observedManifest), scope: 'built-in-only closed fixture root; no native closure claim', checks: ['production-worker-factory', 'raw-state-retention', 'raw-empty-environment', 'raw-empty-argv-execargv', 'raw-worker-exit', 'hung-import-exit-before-timeout', 'bounded-installed-host-diagnostics', 'parent-stdout-isolation', 'frozen-worker-and-fixture', 'missing-manifest', 'five-tuple-mismatches', 'matching-admission-state-and-isolation'] }) + '\n', { encoding: 'utf8', flag: 'wx' });
      } finally {
        try {
          await registry?.closeAll().catch(() => undefined);
          await hungHost?.shutdown().catch(() => undefined);
          await rawHost?.shutdown().catch(() => undefined);
          await hungHost?.worker.terminate().catch(() => undefined);
          await rawHost?.worker.terminate().catch(() => undefined);
        } finally {
          rawExit?.dispose();
          hungExit?.dispose();
          process.stdout.write = originalWrite;
          await rm(fixtureRoot, { recursive: true, force: true });
          await rm(markerPath, { force: true });
        }
      }
    });
  });
}
