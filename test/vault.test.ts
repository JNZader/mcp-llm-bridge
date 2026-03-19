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
