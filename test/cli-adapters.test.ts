/**
 * CLI adapter tests — verify CLI-specific functionality.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Vault } from '../src/vault/vault.js';
import { materializeProviderHome, cleanupAllProviderHomes } from '../src/adapters/cli-home.js';
import { isCliAvailableAsync } from '../src/adapters/cli-utils.js';
import type { GatewayConfig } from '../src/core/types.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-cli-${Date.now()}.db`,
  httpPort: 0,
};

const vault = new Vault(config);

// Cleanup after all tests
process.on('exit', () => {
  cleanupAllProviderHomes();
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

// ── materializeProviderHome tests ──────────────────────────────

describe('materializeProviderHome', () => {
  beforeEach(() => {
    cleanupAllProviderHomes();
  });

  it('creates directory with correct permissions', () => {
    const files = [{ fileName: 'test.json', content: '{"key": "value"}' }];
    const result = materializeProviderHome('test-provider', files);
    
    try {
      assert.ok(existsSync(result.targetDir));
      const stat = statSync(result.targetDir);
      // Mode should be 0o700 (owner read/write/execute)
      assert.equal(stat.mode & 0o777, 0o700);
    } finally {
      result.cleanup();
    }
  });

  it('writes files with correct permissions', () => {
    const files = [{ fileName: 'auth.json', content: '{"token": "secret"}' }];
    const result = materializeProviderHome('test-provider', files);
    
    try {
      const filePath = join(result.targetDir, 'auth.json');
      assert.ok(existsSync(filePath));
      const content = readFileSync(filePath, 'utf8');
      assert.equal(content, '{"token": "secret"}');
      const stat = statSync(filePath);
      // Mode should be 0o600 (owner read/write)
      assert.equal(stat.mode & 0o777, 0o600);
    } finally {
      result.cleanup();
    }
  });

  it('caches directories for same provider/project', () => {
    const files = [{ fileName: 'auth.json', content: '{"token": "secret"}' }];
    
    const result1 = materializeProviderHome('test-provider', files);
    const dir1 = result1.targetDir;
    
    const result2 = materializeProviderHome('test-provider', files);
    const dir2 = result2.targetDir;
    
    // Same directory should be reused
    assert.equal(dir1, dir2);
    
    // Cleanup should be no-op when cached
    result2.cleanup(); // This won't actually delete since it's cached
    assert.ok(existsSync(dir1));
    
    result1.cleanup();
  });

  it('creates different directories for different projects', () => {
    const files1 = [{ fileName: 'auth.json', content: '{"project": "1"}' }];
    const files2 = [{ fileName: 'auth.json', content: '{"project": "2"}' }];
    
    const result1 = materializeProviderHome('test-provider', files1, 'project1');
    const result2 = materializeProviderHome('test-provider', files2, 'project2');
    
    // Different projects should get different directories
    assert.notEqual(result1.targetDir, result2.targetDir);
    
    result1.cleanup();
    result2.cleanup();
  });

  it('recreates directory when files change', () => {
    const files1 = [{ fileName: 'auth.json', content: '{}' }];
    const files2 = [{ fileName: 'auth.json', content: '{"new": true}' }];
    
    const result1 = materializeProviderHome('test-provider', files1);
    const dir1 = result1.targetDir;
    
    const result2 = materializeProviderHome('test-provider', files2);
    const dir2 = result2.targetDir;
    
    // Different content should create different directory
    assert.notEqual(dir1, dir2);
    
    result1.cleanup();
    result2.cleanup();
  });

  it('rejects path traversal attempts', () => {
    const files = [{ fileName: '../etc/passwd', content: 'hacked' }];
    
    assert.throws(() => {
      materializeProviderHome('test-provider', files);
    }, /Unsafe provider file path/);
  });

  it('rejects absolute paths', () => {
    const files = [{ fileName: '/etc/passwd', content: 'hacked' }];
    
    assert.throws(() => {
      materializeProviderHome('test-provider', files);
    }, /Unsafe provider file path/);
  });

  it('creates nested directories', () => {
    const files = [{ fileName: 'config/settings.json', content: '{}' }];
    const result = materializeProviderHome('test-provider', files);
    
    try {
      const filePath = join(result.targetDir, 'config', 'settings.json');
      assert.ok(existsSync(filePath));
    } finally {
      result.cleanup();
    }
  });
});

// ── CLI availability tests ─────────────────────────────────────

describe('isCliAvailableAsync', () => {
  it('returns true for non-existent command after timeout', async () => {
    // Use a command that definitely doesn't exist
    const result = await isCliAvailableAsync('this-command-does-not-exist-12345', ['--help'], 1000);
    assert.equal(result, false);
  });

  it('handles empty command gracefully', async () => {
    const result = await isCliAvailableAsync('', [], 1000);
    assert.equal(result, false);
  });
});

// ── Vault file operations tests ────────────────────────────────

describe('Vault file operations', () => {
  beforeEach(() => {
    (vault as any).db.exec('DELETE FROM files');
  });

  it('stores and retrieves files', () => {
    const id = vault.storeFile('test-provider', 'auth.json', '{"token": "secret"}');
    assert.ok(id > 0);
    
    const content = vault.getFile('test-provider', 'auth.json');
    assert.equal(content, '{"token": "secret"}');
  });

  it('stores files with project scope', () => {
    const id = vault.storeFile('test-provider', 'auth.json', '{}', 'my-project');
    assert.ok(id > 0);
    
    // Should be found with project
    const content = vault.getFile('test-provider', 'auth.json', 'my-project');
    assert.equal(content, '{}');
    
    // Should not be found without project (defaults to global)
    const globalContent = vault.getFile('test-provider', 'auth.json');
    assert.equal(globalContent, null);
  });

  it('falls back to global files', () => {
    vault.storeFile('test-provider', 'config.json', '{"global": true}');
    
    const content = vault.getFile('test-provider', 'config.json', 'some-project');
    assert.equal(content, '{"global": true}');
  });

  it('project files override global files', () => {
    vault.storeFile('test-provider', 'config.json', '{"scope": "global"}');
    vault.storeFile('test-provider', 'config.json', '{"scope": "project"}', 'my-project');
    
    const projectContent = vault.getFile('test-provider', 'config.json', 'my-project');
    assert.equal(projectContent, '{"scope": "project"}');
  });

  it('lists provider files correctly', () => {
    vault.storeFile('claude', 'auth.json', '{}');
    vault.storeFile('claude', 'settings.json', '{}');
    vault.storeFile('openai', 'key.json', '{}');
    
    const files = vault.listProviderFiles('claude');
    assert.equal(files.length, 2);
  });

  it('gets provider files for project', () => {
    vault.storeFile('claude', 'auth.json', '{"global": true}');
    vault.storeFile('claude', 'auth.json', '{"project": true}', 'my-project');
    
    const files = vault.getProviderFiles('claude', 'my-project');
    assert.equal(files.length, 1);
    assert.equal(files[0]!.content, '{"project": true}');
    assert.equal(files[0]!.project, 'my-project');
  });
});
