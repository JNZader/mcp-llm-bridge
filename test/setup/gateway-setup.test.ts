import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveGatewayPort,
  resolveGatewayToken,
  buildGatewayEnv,
  mergeGatewayEnvIntoSettings,
  resolveSettingsPath,
  parseGatewayArgs,
  runSetupGateway,
} from '../../src/setup/gateway-setup.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'llm-bridge-gateway-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── port / token resolution ─────────────────────────────────────

describe('resolveGatewayPort', () => {
  it('defaults to 3456 when LLM_GATEWAY_PORT is unset', () => {
    assert.equal(resolveGatewayPort({}), 3456);
  });

  it('parses LLM_GATEWAY_PORT when set', () => {
    assert.equal(resolveGatewayPort({ LLM_GATEWAY_PORT: '4310' }), 4310);
  });

  it('throws on an invalid port', () => {
    assert.throws(() => resolveGatewayPort({ LLM_GATEWAY_PORT: 'not-a-number' }));
    assert.throws(() => resolveGatewayPort({ LLM_GATEWAY_PORT: '0' }));
    assert.throws(() => resolveGatewayPort({ LLM_GATEWAY_PORT: '70000' }));
  });
});

describe('resolveGatewayToken', () => {
  it('returns undefined when LLM_GATEWAY_AUTH_TOKEN is unset', () => {
    assert.equal(resolveGatewayToken({}), undefined);
  });

  it('returns undefined for a blank/whitespace-only token', () => {
    assert.equal(resolveGatewayToken({ LLM_GATEWAY_AUTH_TOKEN: '   ' }), undefined);
  });

  it('returns the trimmed token when set', () => {
    assert.equal(
      resolveGatewayToken({ LLM_GATEWAY_AUTH_TOKEN: '  my-token-value  ' }),
      'my-token-value',
    );
  });
});

// ── env var construction ────────────────────────────────────────

describe('buildGatewayEnv', () => {
  it('builds ANTHROPIC_BASE_URL from the port, no token key when token is undefined', () => {
    const result = buildGatewayEnv(3456, undefined);
    assert.deepEqual(result, { ANTHROPIC_BASE_URL: 'http://localhost:3456' });
    assert.equal('ANTHROPIC_AUTH_TOKEN' in result, false);
  });

  it('includes ANTHROPIC_AUTH_TOKEN when a token is provided', () => {
    const result = buildGatewayEnv(4310, 'secret-token-value');
    assert.deepEqual(result, {
      ANTHROPIC_BASE_URL: 'http://localhost:4310',
      ANTHROPIC_AUTH_TOKEN: 'secret-token-value',
    });
  });

  it('reflects a custom port in the base URL', () => {
    const result = buildGatewayEnv(9999, undefined);
    assert.equal(result.ANTHROPIC_BASE_URL, 'http://localhost:9999');
  });
});

// ── arg parsing ──────────────────────────────────────────────────

describe('parseGatewayArgs', () => {
  it('defaults to apply:false, scope:user with no args', () => {
    assert.deepEqual(parseGatewayArgs([]), { apply: false, scope: 'user' });
  });

  it('sets apply:true on --apply', () => {
    assert.deepEqual(parseGatewayArgs(['--apply']), { apply: true, scope: 'user' });
  });

  it('parses --scope project (space form)', () => {
    assert.deepEqual(parseGatewayArgs(['--scope', 'project']), { apply: false, scope: 'project' });
  });

  it('parses --scope=project (equals form)', () => {
    assert.deepEqual(parseGatewayArgs(['--scope=project']), { apply: false, scope: 'project' });
  });

  it('combines --apply and --scope', () => {
    assert.deepEqual(parseGatewayArgs(['--apply', '--scope=project']), {
      apply: true,
      scope: 'project',
    });
  });

  it('throws on an invalid --scope value', () => {
    assert.throws(() => parseGatewayArgs(['--scope', 'bogus']));
    assert.throws(() => parseGatewayArgs(['--scope=bogus']));
  });
});

// ── settings path resolution ─────────────────────────────────────

describe('resolveSettingsPath', () => {
  it('resolves the user scope under the home directory', () => {
    const path = resolveSettingsPath('user');
    assert.ok(path.endsWith(join('.claude', 'settings.json')));
  });

  it('resolves the project scope under cwd', () => {
    const path = resolveSettingsPath('project');
    assert.equal(path, join(process.cwd(), '.claude', 'settings.json'));
  });
});

// ── settings.json env-block merge ────────────────────────────────

describe('mergeGatewayEnvIntoSettings', () => {
  it('starts from {} and does not explode when the file does not exist', () => {
    const settingsPath = join(tmpDir, 'does-not-exist.json');

    const result = mergeGatewayEnvIntoSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://localhost:3456',
    });

    assert.equal(result.backupPath, null);
    assert.equal(existsSync(settingsPath), true);

    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(written.env, { ANTHROPIC_BASE_URL: 'http://localhost:3456' });
  });

  it('preserves existing env entries and other top-level keys', () => {
    const settingsPath = join(tmpDir, 'existing.json');
    const original = {
      permissions: { allow: ['Read', 'Edit'] },
      env: { SOME_OTHER_VAR: 'keep-me' },
    };
    writeFileSync(settingsPath, JSON.stringify(original, null, 2), 'utf8');

    const result = mergeGatewayEnvIntoSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://localhost:3456',
      ANTHROPIC_AUTH_TOKEN: 'tok-123',
    });

    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));

    // Untouched top-level key.
    assert.deepEqual(written.permissions, { allow: ['Read', 'Edit'] });

    // Existing env var preserved alongside the new ones.
    assert.equal(written.env.SOME_OTHER_VAR, 'keep-me');
    assert.equal(written.env.ANTHROPIC_BASE_URL, 'http://localhost:3456');
    assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, 'tok-123');

    assert.notEqual(result.backupPath, null);
  });

  it('creates a backup of the original file BEFORE writing, only when the file existed', () => {
    const settingsPath = join(tmpDir, 'with-backup.json');
    const originalContent = JSON.stringify({ hello: 'world', env: {} }, null, 2);
    writeFileSync(settingsPath, originalContent, 'utf8');

    const result = mergeGatewayEnvIntoSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://localhost:3456',
    });

    assert.ok(result.backupPath, 'expected a backup path to be returned');
    assert.equal(existsSync(result.backupPath!), true);
    assert.equal(readFileSync(result.backupPath!, 'utf8'), originalContent);

    const liveContent = readFileSync(settingsPath, 'utf8');
    assert.notEqual(liveContent, originalContent);
  });

  it('does not attempt to back up a file that never existed', () => {
    const settingsPath = join(tmpDir, 'brand-new.json');

    const result = mergeGatewayEnvIntoSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://localhost:3456',
    });

    assert.equal(result.backupPath, null);
  });

  it('is tolerant of corrupted JSON and starts fresh from {} while still backing up the original', () => {
    const settingsPath = join(tmpDir, 'corrupted.json');
    const corrupted = '{ this is not valid json ,,, ';
    writeFileSync(settingsPath, corrupted, 'utf8');

    const result = mergeGatewayEnvIntoSettings(settingsPath, {
      ANTHROPIC_BASE_URL: 'http://localhost:3456',
    });

    assert.ok(result.backupPath, 'expected a backup even for corrupted JSON');
    assert.equal(readFileSync(result.backupPath!, 'utf8'), corrupted);

    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(written.env, { ANTHROPIC_BASE_URL: 'http://localhost:3456' });
  });
});

// ── full orchestration (runSetupGateway) ─────────────────────────

describe('runSetupGateway', () => {
  it('dry run (no --apply): resolves port/token correctly and touches no files', async () => {
    const settingsPath = join(tmpDir, 'settings.json');

    const exitCode = await runSetupGateway([], {
      settingsPathOverride: settingsPath,
      env: { LLM_GATEWAY_PORT: '4310', LLM_GATEWAY_AUTH_TOKEN: 'a-token-value' },
    });

    assert.equal(exitCode, 0);
    assert.equal(existsSync(settingsPath), false, 'dry run must not create the settings file');
  });

  it('--apply writes the env block into settings.json, preserving other keys', async () => {
    const settingsPath = join(tmpDir, 'settings.json');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ permissions: { allow: ['Bash(git status:*)'] } }, null, 2),
      'utf8',
    );

    const exitCode = await runSetupGateway(['--apply'], {
      settingsPathOverride: settingsPath,
      env: { LLM_GATEWAY_PORT: '4310', LLM_GATEWAY_AUTH_TOKEN: 'a-token-value' },
    });

    assert.equal(exitCode, 0);
    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.deepEqual(written.permissions, { allow: ['Bash(git status:*)'] });
    assert.equal(written.env.ANTHROPIC_BASE_URL, 'http://localhost:4310');
    assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, 'a-token-value');
  });

  it('--apply omits ANTHROPIC_AUTH_TOKEN when no bridge token is configured', async () => {
    const settingsPath = join(tmpDir, 'settings-no-token.json');

    const exitCode = await runSetupGateway(['--apply'], {
      settingsPathOverride: settingsPath,
      env: { LLM_GATEWAY_PORT: '3456' },
    });

    assert.equal(exitCode, 0);
    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(written.env.ANTHROPIC_BASE_URL, 'http://localhost:3456');
    assert.equal('ANTHROPIC_AUTH_TOKEN' in written.env, false);
  });

  it('returns exit code 1 on an invalid port', async () => {
    const exitCode = await runSetupGateway([], {
      env: { LLM_GATEWAY_PORT: 'not-a-number' },
    });
    assert.equal(exitCode, 1);
  });

  it('returns exit code 1 on an invalid --scope value', async () => {
    const exitCode = await runSetupGateway(['--scope=bogus'], {
      env: {},
    });
    assert.equal(exitCode, 1);
  });
});
