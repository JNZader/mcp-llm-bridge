/**
 * Bridge config tests — YAML parsing, validation, and loading.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseSimpleYaml, validateConfig, loadBridgeConfig } from '../../src/bridge/config.js';

// ── YAML Parsing ─────────────────────────────────────────────

describe('parseSimpleYaml', () => {
  it('parses a complete bridge config', () => {
    const yaml = `
routes:
  large-context: gemini-cli
  code-review: claude-cli
  fast-completion: codex-cli
default: claude-cli
fallback_order:
  - claude-cli
  - gemini-cli
  - codex-cli
`;
    const result = parseSimpleYaml(yaml);

    assert.deepStrictEqual(result.routes, {
      'large-context': 'gemini-cli',
      'code-review': 'claude-cli',
      'fast-completion': 'codex-cli',
    });
    assert.equal(result.default, 'claude-cli');
    assert.deepStrictEqual(result.fallback_order, ['claude-cli', 'gemini-cli', 'codex-cli']);
  });

  it('parses inline array for fallback_order', () => {
    const yaml = `
default: claude-cli
fallback_order: [claude-cli, gemini-cli]
`;
    const result = parseSimpleYaml(yaml);
    assert.deepStrictEqual(result.fallback_order, ['claude-cli', 'gemini-cli']);
  });

  it('handles comments and empty lines', () => {
    const yaml = `
# This is a comment
routes:
  large-context: gemini-cli  # inline comment

default: claude-cli
fallback_order:
  - claude-cli
`;
    const result = parseSimpleYaml(yaml);
    assert.equal(result.routes?.['large-context'], 'gemini-cli');
    assert.equal(result.default, 'claude-cli');
  });

  it('returns empty config for empty input', () => {
    const result = parseSimpleYaml('');
    assert.deepStrictEqual(result, {});
  });
});

// ── Validation ───────────────────────────────────────────────

describe('validateConfig', () => {
  it('validates a correct config', () => {
    const config = validateConfig({
      routes: { 'large-context': 'gemini-cli', 'code-review': 'claude-cli' },
      default: 'claude-cli',
      fallback_order: ['claude-cli', 'gemini-cli'],
    });

    assert.ok(config);
    assert.equal(config.routes.size, 2);
    assert.equal(config.routes.get('large-context'), 'gemini-cli');
    assert.equal(config.default, 'claude-cli');
    assert.deepStrictEqual(config.fallbackOrder, ['claude-cli', 'gemini-cli']);
  });

  it('returns null when default is missing', () => {
    const config = validateConfig({
      routes: { 'large-context': 'gemini-cli' },
      fallback_order: ['claude-cli'],
    });
    assert.equal(config, null);
  });

  it('returns null when fallback_order is missing', () => {
    const config = validateConfig({
      default: 'claude-cli',
    });
    assert.equal(config, null);
  });

  it('skips unknown task types in routes', () => {
    const config = validateConfig({
      routes: { 'large-context': 'gemini-cli', 'unknown-type': 'some-cli' },
      default: 'claude-cli',
      fallback_order: ['claude-cli'],
    });

    assert.ok(config);
    assert.equal(config.routes.size, 1);
    assert.equal(config.routes.has('unknown-type'), false);
  });

  it('returns valid config with no routes', () => {
    const config = validateConfig({
      default: 'claude-cli',
      fallback_order: ['claude-cli', 'gemini-cli'],
    });

    assert.ok(config);
    assert.equal(config.routes.size, 0);
  });
});

// ── File Loading ─────────────────────────────────────────────

describe('loadBridgeConfig', () => {
  const tmpDir = join(tmpdir(), `bridge-test-${Date.now()}`);

  it('returns null when config file does not exist', () => {
    const config = loadBridgeConfig('/nonexistent/path/bridge.yaml');
    assert.equal(config, null);
  });

  it('loads and parses a valid config file', () => {
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, 'bridge.yaml');
    writeFileSync(
      configPath,
      `routes:\n  code-review: claude-cli\ndefault: claude-cli\nfallback_order:\n  - claude-cli\n  - gemini-cli\n`,
    );

    const config = loadBridgeConfig(configPath);
    assert.ok(config);
    assert.equal(config.routes.get('code-review'), 'claude-cli');
    assert.equal(config.default, 'claude-cli');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for invalid config file content', () => {
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, 'bridge-bad.yaml');
    writeFileSync(configPath, 'just some random text\nno structure here\n');

    const config = loadBridgeConfig(configPath);
    assert.equal(config, null);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
