import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { loadPlugins } from '../../src/mcp-builder/loader.js';
import type { McpServerDefinition } from '../../src/mcp-builder/index.js';

let tempDir: string;

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `mcp-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writePluginFile(name: string, content: string): Promise<void> {
  await writeFile(join(tempDir, `${name}.mcp-server.js`), content, 'utf-8');
}

/** Create a minimal valid definition object for inline plugin content. */
function makeDefinition(name: string): McpServerDefinition {
  return {
    name,
    version: '1.0.0',
    description: 'Test plugin',
    tools: [
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      },
    ],
    resources: [],
    prompts: [],
  };
}

describe('loadPlugins', () => {
  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('finds .mcp-server.js files and returns correct name and definition', async () => {
    const def = makeDefinition('alpha');
    await writePluginFile(
      'alpha',
      `export default ${JSON.stringify(def)};`,
    );

    const result = await loadPlugins(tempDir);

    assert.strictEqual(result.loaded.length, 1);
    assert.strictEqual(result.loaded[0]!.name, 'alpha');
    assert.strictEqual(result.loaded[0]!.definition.name, def.name);
    assert.strictEqual(result.loaded[0]!.definition.version, def.version);
    assert.strictEqual(result.loaded[0]!.definition.description, def.description);
    assert.strictEqual(result.loaded[0]!.definition.tools.length, 1);
    assert.strictEqual(result.loaded[0]!.definition.tools[0]!.name, 'test_tool');
    assert.deepStrictEqual(result.loaded[0]!.definition.resources, []);
    assert.deepStrictEqual(result.loaded[0]!.definition.prompts, []);
    assert.deepStrictEqual(result.skipped, []);
    assert.deepStrictEqual(result.errors, []);
  });

  it('loads plugins from the default relative ./mcp-servers directory', async () => {
    const originalCwd = process.cwd();
    const appRoot = join(tempDir, 'app-root');
    const defaultPluginsDir = join(appRoot, 'mcp-servers');

    await mkdir(defaultPluginsDir, { recursive: true });
    await writeFile(
      join(defaultPluginsDir, 'relative.mcp-server.js'),
      `export default ${JSON.stringify(makeDefinition('relative'))};`,
      'utf-8',
    );

    try {
      process.chdir(appRoot);

        const result = await loadPlugins('./mcp-servers');

        assert.strictEqual(result.loaded.length, 1);
        assert.strictEqual(result.loaded[0]!.name, 'relative');
        assert.strictEqual(result.loaded[0]!.definition.name, 'relative');
      } finally {
        process.chdir(originalCwd);
      }
    });

  it('handles empty directory (returns empty array)', async () => {
    const result = await loadPlugins(tempDir);
    assert.deepStrictEqual(result, { loaded: [], skipped: [], errors: [] });
  });

  it('handles missing directory (returns empty array)', async () => {
    const result = await loadPlugins(join(tempDir, 'nonexistent'));
    assert.deepStrictEqual(result, { loaded: [], skipped: [], errors: [] });
  });

  it('loads plugins from an absolute directory path', async () => {
    const def = makeDefinition('absolute');
    await writePluginFile(
      'absolute',
      `export default ${JSON.stringify(def)};`,
    );

    const result = await loadPlugins(resolve(tempDir));

    assert.strictEqual(result.loaded.length, 1);
    assert.strictEqual(result.loaded[0]!.name, 'absolute');
    assert.strictEqual(result.loaded[0]!.definition.name, def.name);
  });

  it('skips invalid export shape with structured summary', async () => {
    await writePluginFile('bad', `export const notAPlugin = {};`);

    const result = await loadPlugins(tempDir);

    assert.deepStrictEqual(result.loaded, []);
    assert.strictEqual(result.skipped.length, 1);
    assert.strictEqual(result.skipped[0]!.plugin, 'bad');
    assert.strictEqual(result.skipped[0]!.code, 'invalid-top-level-shape');
  });

  it('captures load failures in structured summary', async () => {
    await writePluginFile('broken', `this is not valid javascript {`);

    const result = await loadPlugins(tempDir);

    assert.deepStrictEqual(result.loaded, []);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0]!.plugin, 'broken');
    assert.strictEqual(result.errors[0]!.code, 'load-failed');
  });

  it('falls back to named export (module.server)', async () => {
    const def = makeDefinition('named');
    await writePluginFile(
      'named',
      `export const server = ${JSON.stringify(def)};`,
    );

    const result = await loadPlugins(tempDir);

    assert.strictEqual(result.loaded.length, 1);
    assert.strictEqual(result.loaded[0]!.name, 'named');
    assert.strictEqual(result.loaded[0]!.definition.name, def.name);
    assert.strictEqual(result.loaded[0]!.definition.version, def.version);
    assert.strictEqual(result.loaded[0]!.definition.tools.length, 1);
  });

  it('falls back to module.definition export', async () => {
    const def = makeDefinition('def-export');
    await writePluginFile(
      'def-export',
      `export const definition = ${JSON.stringify(def)};`,
    );

    const result = await loadPlugins(tempDir);

    assert.strictEqual(result.loaded.length, 1);
    assert.strictEqual(result.loaded[0]!.name, 'def-export');
    assert.strictEqual(result.loaded[0]!.definition.name, def.name);
    assert.strictEqual(result.loaded[0]!.definition.version, def.version);
    assert.strictEqual(result.loaded[0]!.definition.tools.length, 1);
  });

  it('ignores non-.mcp-server.js files', async () => {
    await writePluginFile('valid', `export default ${JSON.stringify(makeDefinition('valid'))};`);
    await writeFile(join(tempDir, 'readme.txt'), 'hello', 'utf-8');
    await writeFile(join(tempDir, 'other.js'), 'export default {};', 'utf-8');

    const result = await loadPlugins(tempDir);
    assert.strictEqual(result.loaded.length, 1);
    assert.strictEqual(result.loaded[0]!.name, 'valid');
  });

  it('loads multiple plugins in alphabetical order', async () => {
    await writePluginFile('zebra', `export default ${JSON.stringify(makeDefinition('zebra'))};`);
    await writePluginFile('alpha', `export default ${JSON.stringify(makeDefinition('alpha'))};`);

    const result = await loadPlugins(tempDir);

    assert.strictEqual(result.loaded.length, 2);
    assert.strictEqual(result.loaded[0]!.name, 'alpha');
    assert.strictEqual(result.loaded[1]!.name, 'zebra');
  });

  it('reloads the same plugin file with fresh module state on each call', async () => {
    await writePluginFile(
      'fresh',
      `export default ${JSON.stringify(makeDefinition('first-version'))};`,
    );

    const first = await loadPlugins(tempDir);
    assert.strictEqual(first.loaded[0]!.definition.name, 'first-version');

    await writePluginFile(
      'fresh',
      `export default ${JSON.stringify(makeDefinition('second-version'))};`,
    );

    const second = await loadPlugins(tempDir);
    assert.strictEqual(second.loaded[0]!.definition.name, 'second-version');
  });

  it('rethrows non-ENOENT errors from readdir', async () => {
    // Create a file at the path so readdir throws ENOTDIR
    const filePath = join(tempDir, 'notadir');
    await writeFile(filePath, 'x', 'utf-8');

    await assert.rejects(
      async () => loadPlugins(filePath),
      (err: any) => err.code !== 'ENOENT',
    );
  });
});
