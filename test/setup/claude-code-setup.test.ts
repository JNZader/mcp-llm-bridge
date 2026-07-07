import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  resolvePackageRoot,
  resolveDistEntrypoint,
  mergeClaudeCodeConfig,
} from '../../src/setup/claude-code-setup.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'llm-bridge-setup-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── path resolution ────────────────────────────────────────────

describe('resolvePackageRoot / resolveDistEntrypoint', () => {
  it('resolves the package root and dist/index.js from a src/index.ts-shaped url', () => {
    const fakeRoot = join(tmpDir, 'pkg');
    const fakeSrcIndex = join(fakeRoot, 'src', 'index.ts');
    const url = pathToFileURL(fakeSrcIndex).href;

    assert.equal(resolvePackageRoot(url), fakeRoot);

    const resolved = resolveDistEntrypoint(url);
    assert.equal(resolved.path, join(fakeRoot, 'dist', 'index.js'));
    assert.equal(resolved.root, fakeRoot);
  });

  it('resolves the same root from a dist/index.js-shaped url', () => {
    const fakeRoot = join(tmpDir, 'pkg2');
    const fakeDistIndex = join(fakeRoot, 'dist', 'index.js');
    const url = pathToFileURL(fakeDistIndex).href;

    assert.equal(resolvePackageRoot(url), fakeRoot);
    assert.equal(resolveDistEntrypoint(url).path, join(fakeRoot, 'dist', 'index.js'));
  });

  it('reports exists:false when dist/index.js is missing, true when present', () => {
    const fakeRoot = join(tmpDir, 'pkg3');
    const fakeSrcIndex = join(fakeRoot, 'src', 'index.ts');
    const url = pathToFileURL(fakeSrcIndex).href;

    const missing = resolveDistEntrypoint(url);
    assert.equal(missing.exists, false);

    const distDir = join(fakeRoot, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.js'), '// built\n');

    const present = resolveDistEntrypoint(url);
    assert.equal(present.exists, true);
  });
});

// ── config merge helper ────────────────────────────────────────

describe('mergeClaudeCodeConfig', () => {
  it('starts from {} and does not explode when the file does not exist', () => {
    const configPath = join(tmpDir, 'does-not-exist.json');

    const result = mergeClaudeCodeConfig(configPath, 'llm-bridge', {
      command: 'node',
      args: ['/abs/dist/index.js'],
    });

    assert.equal(result.backupPath, null);
    assert.equal(existsSync(configPath), true);

    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(written.mcpServers['llm-bridge'], {
      command: 'node',
      args: ['/abs/dist/index.js'],
    });
  });

  it('preserves existing mcpServers entries and other top-level keys', () => {
    const configPath = join(tmpDir, 'existing.json');
    const original = {
      firstStartTime: '2026-01-01T00:00:00.000Z',
      someTopLevelKey: { nested: true },
      mcpServers: {
        'other-server': { command: 'other', args: ['--flag'] },
      },
    };
    writeFileSync(configPath, JSON.stringify(original, null, 2), 'utf8');

    const result = mergeClaudeCodeConfig(configPath, 'llm-bridge', {
      command: 'node',
      args: ['/abs/dist/index.js'],
    });

    const written = JSON.parse(readFileSync(configPath, 'utf8'));

    // Untouched top-level keys.
    assert.equal(written.firstStartTime, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(written.someTopLevelKey, { nested: true });

    // Existing server entry untouched.
    assert.deepEqual(written.mcpServers['other-server'], { command: 'other', args: ['--flag'] });

    // New server entry added.
    assert.deepEqual(written.mcpServers['llm-bridge'], {
      command: 'node',
      args: ['/abs/dist/index.js'],
    });

    assert.notEqual(result.backupPath, null);
  });

  it('creates a backup of the original file BEFORE writing, only when the file existed', () => {
    const configPath = join(tmpDir, 'with-backup.json');
    const originalContent = JSON.stringify({ hello: 'world', mcpServers: {} }, null, 2);
    writeFileSync(configPath, originalContent, 'utf8');

    const result = mergeClaudeCodeConfig(configPath, 'llm-bridge', { command: 'node', args: [] });

    assert.ok(result.backupPath, 'expected a backup path to be returned');
    assert.equal(existsSync(result.backupPath!), true);

    const backupContent = readFileSync(result.backupPath!, 'utf8');
    assert.equal(backupContent, originalContent);

    // The live file should now differ (it has the new server merged in).
    const liveContent = readFileSync(configPath, 'utf8');
    assert.notEqual(liveContent, originalContent);
  });

  it('does not attempt to back up a file that never existed', () => {
    const configPath = join(tmpDir, 'brand-new.json');

    const result = mergeClaudeCodeConfig(configPath, 'llm-bridge', { command: 'node', args: [] });

    assert.equal(result.backupPath, null);

    // No stray .bak-* files should exist in tmpDir.
    const entries: string[] = readdirSync(tmpDir);
    const backups = entries.filter((f) => f.includes('.bak-'));
    assert.deepEqual(backups, []);
  });

  it('is tolerant of corrupted JSON and starts fresh from {} while still backing up the original', () => {
    const configPath = join(tmpDir, 'corrupted.json');
    const corrupted = '{ this is not valid json ,,, ';
    writeFileSync(configPath, corrupted, 'utf8');

    const result = mergeClaudeCodeConfig(configPath, 'llm-bridge', { command: 'node', args: [] });

    assert.ok(result.backupPath, 'expected a backup even for corrupted JSON');
    assert.equal(readFileSync(result.backupPath!, 'utf8'), corrupted);

    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(written.mcpServers['llm-bridge'], { command: 'node', args: [] });
  });
});
