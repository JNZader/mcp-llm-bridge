import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PluginRuntimeConfigError,
  dynamicMcpServersEnabled,
  pluginRuntimeConfig,
} from '../../src/core/mcp-runtime-config.js';

const ENV_KEYS = [
  'MCP_DYNAMIC_SERVERS',
  'MCP_PLUGIN_RUNTIME_MODE',
  'MCP_PLUGIN_WORKER_ENV_ALLOWLIST',
  'MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST',
  'PLUGIN_TOKEN',
  'SECOND_TOKEN',
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function compatibleManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    nodeMajor: Number.parseInt(process.versions.node.split('.')[0]!, 10),
    platform: process.platform,
    arch: process.arch,
    workerEntryHash: 'a'.repeat(64),
    installedPluginDigest: 'b'.repeat(64),
    ...overrides,
  });
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('plugin runtime configuration', () => {
  it('keeps the dynamic-server gate and legacy mode as defaults', () => {
    delete process.env['MCP_DYNAMIC_SERVERS'];
    delete process.env['MCP_PLUGIN_RUNTIME_MODE'];

    assert.equal(dynamicMcpServersEnabled(), false);
    assert.equal(pluginRuntimeConfig(), undefined);

    process.env['MCP_DYNAMIC_SERVERS'] = 'true';
    assert.deepEqual(pluginRuntimeConfig(), { mode: 'legacy', environment: {} });
  });

  it('accepts only explicit legacy or worker modes without secret-bearing errors', () => {
    process.env['MCP_DYNAMIC_SERVERS'] = 'true';
    process.env['MCP_PLUGIN_RUNTIME_MODE'] = 'not-a-mode:secret-value';

    assert.throws(
      () => pluginRuntimeConfig(),
      (error: unknown) => error instanceof PluginRuntimeConfigError
        && error.code === 'CONFIG_INVALID'
        && !error.message.includes('secret-value'),
    );
  });

  it('copies only present explicit allowlist values and rejects invalid entries', () => {
    process.env['MCP_DYNAMIC_SERVERS'] = 'true';
    process.env['MCP_PLUGIN_WORKER_ENV_ALLOWLIST'] = 'PLUGIN_TOKEN,SECOND_TOKEN,MISSING_TOKEN';
    process.env['PLUGIN_TOKEN'] = 'kept';
    process.env['SECOND_TOKEN'] = 'also-kept';

    assert.deepEqual(pluginRuntimeConfig(), {
      mode: 'legacy',
      environment: { PLUGIN_TOKEN: 'kept', SECOND_TOKEN: 'also-kept' },
    });

    for (const allowlist of ['PLUGIN_TOKEN,PLUGIN_TOKEN', 'NODE_OPTIONS', 'NODE_PATH', 'bad-name']) {
      process.env['MCP_PLUGIN_WORKER_ENV_ALLOWLIST'] = allowlist;
      assert.throws(
        () => pluginRuntimeConfig(),
        (error: unknown) => error instanceof PluginRuntimeConfigError && error.code === 'CONFIG_INVALID',
      );
    }
  });

  it('requires complete observed compatibility evidence for explicit worker mode without implicit fallback', () => {
    process.env['MCP_DYNAMIC_SERVERS'] = 'true';
    process.env['MCP_PLUGIN_RUNTIME_MODE'] = 'worker';

    assert.throws(
      () => pluginRuntimeConfig(),
      (error: unknown) => error instanceof PluginRuntimeConfigError && error.code === 'COMPATIBILITY_UNESTABLISHED',
    );

    process.env['MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST'] = compatibleManifest({ platform: 'not-this-platform' });
    assert.throws(
      () => pluginRuntimeConfig(),
      (error: unknown) => error instanceof PluginRuntimeConfigError && error.code === 'COMPATIBILITY_UNESTABLISHED',
    );

    process.env['MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST'] = compatibleManifest();
    const config = pluginRuntimeConfig({
      workerEntryHash: 'a'.repeat(64),
      installedPluginDigest: 'b'.repeat(64),
    });
    assert.equal(config?.mode, 'worker');

    process.env['MCP_PLUGIN_RUNTIME_MODE'] = 'legacy';
    delete process.env['MCP_PLUGIN_WORKER_COMPATIBILITY_MANIFEST'];
    assert.deepEqual(pluginRuntimeConfig(), { mode: 'legacy', environment: {} });
  });
});
