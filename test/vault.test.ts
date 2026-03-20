/**
 * Vault tests — credential storage with AES-256-GCM encryption.
 *
 * Uses a temporary SQLite database per test run and cleans up after.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { encrypt, decrypt } from '../src/vault/crypto.js';
import { Vault } from '../src/vault/vault.js';
import type { GatewayConfig } from '../src/core/types.js';

/** Create a test config with a random master key and temp DB. */
function createTestConfig(): GatewayConfig {
  const masterKey = randomBytes(32);
  const dbPath = `/tmp/test-vault-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  return { masterKey, dbPath, httpPort: 0 };
}

// ── Crypto roundtrip ──────────────────────────────────────

describe('encrypt/decrypt', () => {
  it('roundtrips plaintext through AES-256-GCM', () => {
    const masterKey = randomBytes(32);
    const plaintext = 'sk-ant-api03-test-key-1234567890';

    const encrypted = encrypt(plaintext, masterKey);
    const decrypted = decrypt(encrypted, masterKey);

    assert.equal(decrypted, plaintext);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const masterKey = randomBytes(32);
    const plaintext = 'same-key-value';

    const a = encrypt(plaintext, masterKey);
    const b = encrypt(plaintext, masterKey);

    assert.ok(!a.encrypted.equals(b.encrypted) || !a.iv.equals(b.iv),
      'Two encryptions of the same value should differ (random IV)');
  });

  it('fails to decrypt with wrong key', () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);
    const data = encrypt('secret', key1);

    assert.throws(() => decrypt(data, key2));
  });
});

// ── Vault CRUD ────────────────────────────────────────────

describe('Vault', () => {
  const config = createTestConfig();
  const vault = new Vault(config);

  after(() => {
    vault.close();
    // Clean up temp DB files (SQLite WAL/SHM files too)
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = config.dbPath + suffix;
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('store and getDecrypted roundtrip', () => {
    const apiKey = 'sk-ant-api03-abc123def456';
    vault.store('anthropic', 'default', apiKey);

    const retrieved = vault.getDecrypted('anthropic', 'default');
    assert.equal(retrieved, apiKey);
  });

  it('has() returns true for stored credential', () => {
    vault.store('openai', 'default', 'sk-openai-test');
    assert.equal(vault.has('openai'), true);
  });

  it('has() returns false for missing credential', () => {
    assert.equal(vault.has('nonexistent'), false);
  });

  it('upserts on same (provider, keyName)', () => {
    vault.store('anthropic', 'default', 'old-key');
    vault.store('anthropic', 'default', 'new-key');

    const retrieved = vault.getDecrypted('anthropic', 'default');
    assert.equal(retrieved, 'new-key');
  });

  it('getDecrypted throws for missing credential', () => {
    assert.throws(
      () => vault.getDecrypted('nonexistent'),
      /No credential found/,
    );
  });

  it('listMasked returns masked values', () => {
    vault.store('test-provider', 'default', 'sk-test-very-long-key-12345');
    const list = vault.listMasked();
    const entry = list.find(c => c.provider === 'test-provider');

    assert.ok(entry, 'Should find test-provider in list');
    assert.ok(entry.maskedValue.includes('...***'), 'Masked value should contain ...***');
    assert.ok(!entry.maskedValue.includes('12345'), 'Masked value should not contain full key');
    assert.ok(entry.id > 0, 'Should have a valid id');
    assert.ok(entry.createdAt, 'Should have createdAt');
    assert.ok(entry.updatedAt, 'Should have updatedAt');
  });

  it('listMasked includes project field', () => {
    const list = vault.listMasked();
    const entry = list.find(c => c.provider === 'test-provider');

    assert.ok(entry, 'Should find test-provider in list');
    assert.equal(entry.project, '_global', 'Default project should be _global');
  });

  it('delete removes credential', () => {
    const id = vault.store('to-delete', 'default', 'delete-me');
    assert.equal(vault.has('to-delete'), true);

    vault.delete(id);
    assert.equal(vault.has('to-delete'), false);
  });

  // ── Mask function edge cases ──────────────────────

  it('mask: long key shows first 7 chars + ...***', () => {
    const masked = vault.mask('sk-ant-api03-long-key-value');
    assert.equal(masked, 'sk-ant-...***');
  });

  it('mask: short key (≤ 4 chars) returns ***', () => {
    const masked = vault.mask('abcd');
    assert.equal(masked, '***');
  });

  it('mask: 5-char key shows partial', () => {
    const masked = vault.mask('abcde');
    assert.ok(masked.endsWith('...***'));
    assert.ok(masked.length < 'abcde'.length + 6);
  });

  it('mask: empty string returns ***', () => {
    const masked = vault.mask('');
    assert.equal(masked, '***');
  });
});

// ── Project scoping ───────────────────────────────────────

describe('Vault project scoping', () => {
  const config = createTestConfig();
  const vault = new Vault(config);

  after(() => {
    vault.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = config.dbPath + suffix;
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('store with project creates project-scoped credential', () => {
    vault.store('anthropic', 'default', 'sk-global-key');
    vault.store('anthropic', 'default', 'sk-ghagga-key', 'ghagga');

    const globalKey = vault.getDecrypted('anthropic', 'default');
    assert.equal(globalKey, 'sk-global-key', 'Without project should return global');

    const projectKey = vault.getDecrypted('anthropic', 'default', 'ghagga');
    assert.equal(projectKey, 'sk-ghagga-key', 'With project should return project-specific');
  });

  it('getDecrypted falls back to global when project-specific not found', () => {
    vault.store('openai', 'default', 'sk-openai-global');

    const key = vault.getDecrypted('openai', 'default', 'nonexistent-project');
    assert.equal(key, 'sk-openai-global', 'Should fall back to global credential');
  });

  it('getDecrypted throws when neither project nor global found', () => {
    assert.throws(
      () => vault.getDecrypted('missing-provider', 'default', 'some-project'),
      /No credential found/,
    );
  });

  it('getDecrypted error message mentions project when scoped', () => {
    try {
      vault.getDecrypted('missing-provider', 'default', 'my-project');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('my-project'), 'Error should mention the project');
      assert.ok(err.message.includes('global'), 'Error should mention global fallback');
    }
  });

  it('has() checks project-specific first, then global', () => {
    vault.store('groq', 'default', 'sk-groq-global');

    // Has global
    assert.equal(vault.has('groq'), true);

    // Has via fallback when checking nonexistent project
    assert.equal(vault.has('groq', 'default', 'some-project'), true);

    // Store project-specific
    vault.store('groq', 'default', 'sk-groq-project', 'my-project');
    assert.equal(vault.has('groq', 'default', 'my-project'), true);
  });

  it('has() returns false when neither project nor global exists', () => {
    assert.equal(vault.has('no-provider', 'default', 'some-project'), false);
  });

  it('store without project defaults to _global', () => {
    vault.store('test-default', 'default', 'sk-test-default');
    const list = vault.listMasked();
    const entry = list.find(c => c.provider === 'test-default');
    assert.ok(entry);
    assert.equal(entry.project, '_global');
  });

  it('upserts on same (provider, keyName, project)', () => {
    vault.store('upsert-test', 'default', 'old-value', 'proj');
    vault.store('upsert-test', 'default', 'new-value', 'proj');

    const retrieved = vault.getDecrypted('upsert-test', 'default', 'proj');
    assert.equal(retrieved, 'new-value');
  });

  it('same provider/keyName can have different values per project', () => {
    vault.store('multi-proj', 'default', 'val-global');
    vault.store('multi-proj', 'default', 'val-alpha', 'alpha');
    vault.store('multi-proj', 'default', 'val-beta', 'beta');

    assert.equal(vault.getDecrypted('multi-proj', 'default'), 'val-global');
    assert.equal(vault.getDecrypted('multi-proj', 'default', 'alpha'), 'val-alpha');
    assert.equal(vault.getDecrypted('multi-proj', 'default', 'beta'), 'val-beta');
  });

  it('listMasked() without project returns all credentials', () => {
    const list = vault.listMasked();
    const providers = list.map(c => c.provider);

    assert.ok(providers.includes('anthropic'), 'Should include anthropic');
    assert.ok(providers.includes('openai'), 'Should include openai');

    // Should include both global and project-scoped entries for anthropic
    const anthropicEntries = list.filter(c => c.provider === 'anthropic');
    assert.ok(anthropicEntries.length >= 2, 'Should have both global and project-scoped anthropic');
  });

  it('listMasked(project) returns project + global credentials', () => {
    const list = vault.listMasked('ghagga');

    // Should include ghagga-scoped entries
    const ghagga = list.filter(c => c.project === 'ghagga');
    assert.ok(ghagga.length > 0, 'Should include ghagga-scoped credentials');

    // Should include global entries
    const global = list.filter(c => c.project === '_global');
    assert.ok(global.length > 0, 'Should include global credentials');

    // Should NOT include other projects
    const other = list.filter(c => c.project !== '_global' && c.project !== 'ghagga');
    assert.equal(other.length, 0, 'Should not include credentials from other projects');
  });

  it('listMasked(_global) returns only global credentials', () => {
    const list = vault.listMasked('_global');
    const nonGlobal = list.filter(c => c.project !== '_global');
    assert.equal(nonGlobal.length, 0, 'Should only include global credentials');
  });

  it('getProviderFiles returns project-specific files before global fallbacks', () => {
    vault.storeFile('gemini', 'settings.json', '{"scope":"global"}');
    vault.storeFile('gemini', 'oauth_creds.json', '{"token":"global"}');
    vault.storeFile('gemini', 'settings.json', '{"scope":"project"}', 'proj-a');
    vault.storeFile('gemini', 'state.json', '{"state":"project"}', 'proj-a');

    const files = vault.getProviderFiles('gemini', 'proj-a');

    assert.deepEqual(files, [
      { fileName: 'settings.json', content: '{"scope":"project"}', project: 'proj-a' },
      { fileName: 'state.json', content: '{"state":"project"}', project: 'proj-a' },
      { fileName: 'oauth_creds.json', content: '{"token":"global"}', project: '_global' },
    ]);
  });

  it('listProviderFiles returns only global files when no project is specified', () => {
    vault.storeFile('codex', 'auth.json', '{"scope":"global"}');
    vault.storeFile('codex', 'auth.json', '{"scope":"project"}', 'proj-b');
    vault.storeFile('codex', 'session.json', '{"global":true}');

    const files = vault.listProviderFiles('codex');

    assert.deepEqual(files.map((file) => ({
      fileName: file.fileName,
      project: file.project,
    })), [
      { fileName: 'auth.json', project: '_global' },
      { fileName: 'session.json', project: '_global' },
    ]);
  });

  it('getProviderFiles returns only global files when project is _global', () => {
    const files = vault.getProviderFiles('codex', '_global');

    assert.deepEqual(files, [
      { fileName: 'auth.json', content: '{"scope":"global"}', project: '_global' },
      { fileName: 'session.json', content: '{"global":true}', project: '_global' },
    ]);
  });
});
