/**
 * Vault concurrency tests — verify concurrent access safety.
 */

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { Vault } from '../src/vault/vault.js';
import type { GatewayConfig } from '../src/core/types.js';

const config: GatewayConfig = {
  masterKey: randomBytes(32),
  dbPath: `/tmp/test-concurrency-${Date.now()}.db`,
  httpPort: 0,
};

after(() => {
  vault.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = config.dbPath + suffix;
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});

const vault = new Vault(config);

// ── Concurrent reads ─────────────────────────────────────────

describe('Vault concurrent access', () => {
  beforeEach(() => {
    (vault as any).db.exec('DELETE FROM credentials');
    (vault as any).db.exec('DELETE FROM files');
  });

  it('handles concurrent reads without errors', async () => {
    // Store a credential
    vault.store('test-provider', 'api-key', 'secret-value-12345');
    
    // Read concurrently
    const reads = Array.from({ length: 10 }, (_) =>
      Promise.resolve().then(() => {
        const has = vault.has('test-provider', 'api-key');
        const value = vault.getDecrypted('test-provider', 'api-key');
        return { has, value };
      })
    );
    
    const results = await Promise.all(reads);
    
    // All reads should succeed
    for (const result of results) {
      assert.equal(result.has, true);
      assert.equal(result.value, 'secret-value-12345');
    }
  });

  it('handles concurrent writes to different keys', async () => {
    // Write concurrently to different providers
    const writes = Array.from({ length: 10 }, (_, i) => 
      Promise.resolve().then(() => {
        vault.store(`provider-${i}`, 'api-key', `secret-${i}`);
      })
    );
    
    await Promise.all(writes);
    
    // All credentials should be stored
    for (let i = 0; i < 10; i++) {
      const has = vault.has(`provider-${i}`, 'api-key');
      assert.equal(has, true);
    }
  });

  it('handles concurrent list operations', async () => {
    // Store multiple credentials
    for (let i = 0; i < 20; i++) {
      vault.store(`provider-${i}`, 'key', `value-${i}`);
    }
    
    // List concurrently
    const lists = Array.from({ length: 5 }, () => 
      Promise.resolve().then(() => vault.listMasked())
    );
    
    const results = await Promise.all(lists);
    
    // All lists should return same count
    for (const list of results) {
      assert.equal(list.length, 20);
    }
  });

  it('handles concurrent read and write', async () => {
    // Store initial credential
    vault.store('provider', 'key', 'initial');
    
    // Concurrent read and write
    const operations = [
      Promise.resolve().then(() => vault.getDecrypted('provider', 'key')),
      Promise.resolve().then(() => vault.store('provider', 'key', 'updated')),
      Promise.resolve().then(() => vault.has('provider', 'key')),
      Promise.resolve().then(() => vault.listMasked()),
    ];
    
    await Promise.all(operations);
    
    // Should not throw - all operations should complete
    assert.ok(true);
  });

  it('handles concurrent deletes', async () => {
    // Store multiple credentials
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(vault.store(`provider-${i}`, 'key', 'value'));
    }
    
    // Delete concurrently
    const deletes = ids.map(id => 
      Promise.resolve().then(() => {
        try {
          vault.delete(id);
        } catch {
          // Ignore delete errors (already deleted)
        }
      })
    );
    
    await Promise.all(deletes);
    
    // All should be deleted
    for (let i = 0; i < 5; i++) {
      const has = vault.has(`provider-${i}`, 'key');
      assert.equal(has, false);
    }
  });

  it('handles concurrent upserts', async () => {
    // Store same key concurrently
    const writes = Array.from({ length: 10 }, () => 
      Promise.resolve().then(() => vault.store('provider', 'key', 'concurrent-value'))
    );
    
    await Promise.all(writes);
    
    // Should have only one value (last write wins, but no errors)
    const has = vault.has('provider', 'key');
    assert.equal(has, true);
    
    const value = vault.getDecrypted('provider', 'key');
    assert.equal(value, 'concurrent-value');
  });

  it('handles concurrent file operations', async () => {
    // Store file
    vault.storeFile('provider', 'file.json', '{}');
    
    // Concurrent reads
    const reads = Array.from({ length: 10 }, () => 
      Promise.resolve().then(() => vault.getFile('provider', 'file.json'))
    );
    
    const results = await Promise.all(reads);
    
    // All reads should return same content
    for (const result of results) {
      assert.equal(result, '{}');
    }
  });

  it('project scoping works under concurrency', async () => {
    // Store global and project-specific
    vault.store('provider', 'key', 'global-value');
    vault.store('provider', 'key', 'project-value', 'my-project');
    
    // Concurrent reads
    const globalRead = Promise.resolve().then(() => vault.getDecrypted('provider', 'key'));
    const projectRead = Promise.resolve().then(() => vault.getDecrypted('provider', 'key', 'my-project'));
    
    const [global, project] = await Promise.all([globalRead, projectRead]);
    
    assert.equal(global, 'global-value');
    assert.equal(project, 'project-value');
  });
});
