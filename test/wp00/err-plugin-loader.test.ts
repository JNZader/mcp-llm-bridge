import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPlugins } from '../../src/mcp-builder/loader.js';

const CANARY = 'private-plugin-diagnostic-canary';
const DEFINITION = { name: 'Intentional plugin', version: '1.0.0', description: 'Intentional metadata',
  tools: [], resources: [], prompts: [] };

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'wp00-plugin-errors-'));
  const previous = process.env.MCP_PLUGIN_LOAD_TIMEOUT_MS;
  process.env.MCP_PLUGIN_LOAD_TIMEOUT_MS = '2000';
  try { await run(directory); }
  finally {
    if (previous === undefined) delete process.env.MCP_PLUGIN_LOAD_TIMEOUT_MS;
    else process.env.MCP_PLUGIN_LOAD_TIMEOUT_MS = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

async function plugin(directory: string, name: string, source: string) {
  await writeFile(join(directory, name + '.mcp-server.js'), source, 'utf8');
}

async function noShadows(directory: string) {
  assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith('.mcp-loader-')), []);
}

describe('Plugin loader diagnostic message containment', { concurrency: false }, () => {
  const failures = [
    ['error', `throw new Error('${CANARY}');`],
    ['string', `throw '${CANARY}';`],
    ['getter', `throw Object.defineProperty(new Error(), 'message', { get: inspected });`],
    ['coercion', `throw { [Symbol.toPrimitive]: inspected, toString: inspected };`],
    ['proxy', `throw new Proxy({}, {
      get(_target, key) { return inspected('get', key); },
      getPrototypeOf() { return inspected('getPrototypeOf', null); }
    });`],
    ['revoked', `const p = Proxy.revocable({}, {}); p.revoke(); throw p.proxy;`],
    ['timeout-imitation', `throw Object.assign(new Error('${CANARY}'), { name: 'PluginImportTimeoutError', code: 'load-timeout' });`],
  ];
  for (const [name, source] of failures) {
    it('contains ' + name + ' without inspecting the rejected value', { timeout: 5000 }, async () => {
      await fixture(async (directory) => {
        // Module-local state proves getter/coercion accesses without process globals.
        const statePath = join(directory, 'state.mjs');
        await writeFile(statePath, `export let accesses = 0;
export const events = [];
export function reset() { accesses = 0; events.length = 0; }
export function inspected(kind, key) { accesses++; events.push({ kind, key }); throw new Error('${CANARY}'); }`);
        const state: { accesses: number; events: unknown[]; reset: () => void } =
          await import(pathToFileURL(statePath).href);
        const moduleSource = `import { inspected } from './state.mjs';\n${source}`;
        let baselineEvents: unknown[] = [];
        if (name === 'proxy') {
          // Native .mjs matches the loader's shadow module; tsx .js is not equivalent.
          const baselinePath = join(directory, 'native-baseline.mjs');
          await writeFile(baselinePath, moduleSource);
          let rejected = false;
          try { await import(pathToFileURL(baselinePath).href); } catch { rejected = true; }
          assert.equal(rejected, true);
          baselineEvents = structuredClone(state.events);
          // Node 22's module-job diagnostic examines the rejected value's name.
          assert.deepEqual(baselineEvents, [{ kind: 'get', key: 'name' }]);
          assert.equal(state.accesses, baselineEvents.length);
          state.reset();
        }
        await plugin(directory, 'broken', moduleSource);
        const result = await loadPlugins(directory);
        assert.deepEqual(result.loaded, []);
        assert.deepEqual(result.skipped, []);
        assert.deepEqual(result.errors, [{ plugin: 'broken', file: 'broken.mcp-server.js',
          code: 'load-failed', message: 'Plugin loading failed.' }]);
        if (name === 'proxy') {
          assert.deepEqual(state.events, baselineEvents, 'Loader must add no inspection beyond native import');
          assert.equal(state.accesses, baselineEvents.length);
        } else {
          assert.equal(state.accesses, 0);
        }
        await noShadows(directory);
      });
    });
  }

  it('keeps invalid-shape identity fields while fixing only diagnostic text', async () => {
    await fixture(async (directory) => {
      await plugin(directory, CANARY, 'export default {};');
      const result = await loadPlugins(directory);
      assert.deepEqual(result.loaded, []);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.skipped, [{ plugin: CANARY, file: CANARY + '.mcp-server.js',
        code: 'invalid-top-level-shape', message: 'Plugin definition is invalid.' }]);
      // Raw identity remains compatibility data, not scanner-issued admission.
      assert.equal(result.skipped[0]?.plugin, CANARY);
      await noShadows(directory);
    });
  });

  it('preserves mixed valid tools and metadata while containing security diagnostics', async () => {
    await fixture(async (directory) => {
      await plugin(directory, 'mixed', `export default { ...${JSON.stringify(DEFINITION)}, tools: [
{ name: 'valid', description: 'Intentional tool', inputSchema: { type: 'object' }, security: { category: 'read' }, handler() { throw new Error('Handler must not execute'); } },
{ name: '${CANARY}', security: { category: 'invalid' } }
] };`);
      const result = await loadPlugins(directory);
      assert.equal(result.loaded.length, 1);
      const loaded = result.loaded[0];
      assert.ok(loaded);
      assert.equal(loaded.name, 'mixed');
      assert.deepEqual({ ...loaded.definition, tools: [] }, DEFINITION);
      assert.equal(loaded.definition.tools.length, 1);
      const tool = loaded.definition.tools[0];
      assert.ok(tool);
      assert.equal(tool.name, 'valid');
      assert.deepEqual(tool.security, { category: 'read' });
      assert.equal(typeof tool.handler, 'function');
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.skipped, [{ plugin: 'mixed', file: 'mixed.mcp-server.js', toolName: CANARY,
        code: 'invalid-tool-security', message: 'Plugin tool security metadata is invalid.' }]);
      await noShadows(directory);
    });
  });

  it('classifies a real timeout and waits for the finite module to settle before cleanup', { timeout: 5000 }, async () => {
    await fixture(async (directory) => {
      const statePath = join(directory, 'settlement.mjs');
      await writeFile(statePath, 'export let finish; export const finished = new Promise(resolve => { finish = resolve; });');
      const state: { finished: Promise<void> } = await import(pathToFileURL(statePath).href);
      await plugin(directory, 'slow', `import { finish } from './settlement.mjs';
try { await new Promise(resolve => setTimeout(resolve, 100)); } finally { finish(); }
export default ${JSON.stringify(DEFINITION)};`);
      process.env.MCP_PLUGIN_LOAD_TIMEOUT_MS = '25';
      try {
        const result = await loadPlugins(directory);
        assert.deepEqual(result.loaded, []);
        assert.deepEqual(result.skipped, []);
        assert.deepEqual(result.errors, [{ plugin: 'slow', file: 'slow.mcp-server.js',
          code: 'load-timeout', message: 'Plugin loading timed out.' }]);
        await noShadows(directory);
      } finally {
        await state.finished;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
  });

  it('preserves deterministic ordering and default/server/definition export precedence', async () => {
    await fixture(async (directory) => {
      await plugin(directory, 'c', `export const definition = ${JSON.stringify(DEFINITION)};`);
      await plugin(directory, 'a', `export default ${JSON.stringify(DEFINITION)}; export const server = {};`);
      await plugin(directory, 'b', `export const server = ${JSON.stringify(DEFINITION)}; export const definition = {};`);
      await writeFile(join(directory, 'ignored.txt'), CANARY);
      const result = await loadPlugins(directory);
      assert.deepEqual(result.loaded, ['a', 'b', 'c'].map((name) => ({ name, definition: DEFINITION })));
      assert.deepEqual(result.skipped, []);
      assert.deepEqual(result.errors, []);
      await noShadows(directory);
    });
  });
});
