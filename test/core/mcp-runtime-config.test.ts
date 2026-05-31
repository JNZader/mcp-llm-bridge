import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MCP_SERVERS_DIR,
  dynamicMcpServersEnabled,
  mcpServersDir,
} from '../../src/core/mcp-runtime-config.js';

const ENV_KEYS = ['MCP_DYNAMIC_SERVERS', 'MCP_SERVERS_DIR'] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
});

describe('mcp runtime config', () => {
  it('uses the documented defaults', () => {
    delete process.env['MCP_DYNAMIC_SERVERS'];
    delete process.env['MCP_SERVERS_DIR'];

    assert.equal(dynamicMcpServersEnabled(), false);
    assert.equal(mcpServersDir(), DEFAULT_MCP_SERVERS_DIR);
  });

  it('reads env mutations at call time after import', () => {
    delete process.env['MCP_DYNAMIC_SERVERS'];
    delete process.env['MCP_SERVERS_DIR'];

    assert.equal(dynamicMcpServersEnabled(), false);
    assert.equal(mcpServersDir(), DEFAULT_MCP_SERVERS_DIR);

    process.env['MCP_DYNAMIC_SERVERS'] = 'true';
    process.env['MCP_SERVERS_DIR'] = '/tmp/custom-mcp-servers';

    assert.equal(dynamicMcpServersEnabled(), true);
    assert.equal(mcpServersDir(), '/tmp/custom-mcp-servers');
  });

  it('preserves falsey string fallback behavior for server dir', () => {
    process.env['MCP_SERVERS_DIR'] = '';

    assert.equal(mcpServersDir(), DEFAULT_MCP_SERVERS_DIR);
  });
});
