/**
 * Vault Audit Logging Tests
 *
 * Verifies that every vault operation emits structured audit log events
 * via the Pino child logger, and that decrypted values are NEVER logged.
 */

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';

import { Vault, vaultAuditLogger } from '../src/vault/vault.js';
import type { GatewayConfig } from '../src/core/types.js';

/** Create a test config with a random master key and temp DB. */
function createTestConfig(): GatewayConfig {
  const masterKey = randomBytes(32);
  const dbPath = `/tmp/test-vault-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  return { masterKey, dbPath, httpPort: 0 };
}

/** Captured log calls: [level, object]. */
type LogCapture = { level: string; data: Record<string, unknown> };

/**
 * Intercept vaultAuditLogger calls by monkey-patching info/error.
 * Returns an array that fills up with captured events.
 */
function captureAuditLogs(): { logs: LogCapture[]; restore: () => void } {
  const logs: LogCapture[] = [];

  const origInfo = vaultAuditLogger.info.bind(vaultAuditLogger);
  const origError = vaultAuditLogger.error.bind(vaultAuditLogger);

  // Pino's .info / .error accept (obj, msg?) or (msg, ...args)
  // We only care about the object-first form used by our code.
  vaultAuditLogger.info = ((obj: Record<string, unknown>) => {
    logs.push({ level: 'info', data: obj });
    // Don't call origInfo to keep test output clean
  }) as typeof vaultAuditLogger.info;

  vaultAuditLogger.error = ((obj: Record<string, unknown>) => {
    logs.push({ level: 'error', data: obj });
  }) as typeof vaultAuditLogger.error;

  return {
    logs,
    restore() {
      vaultAuditLogger.info = origInfo;
      vaultAuditLogger.error = origError;
    },
  };
}

describe('Vault Audit Logging', () => {
  const config = createTestConfig();
  const vault = new Vault(config);
  let capture: ReturnType<typeof captureAuditLogs>;

  beforeEach(() => {
    capture = captureAuditLogs();
  });

  // Restore logger after each test implicitly via next beforeEach / after
  after(() => {
    // Ensure restore
    if (capture) capture.restore();
    vault.destroy();
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = config.dbPath + suffix;
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  // ── store() ────────────────────────────────────────────

  it('logs audit event on store()', () => {
    vault.store('openai', 'default', 'sk-test-key-123', 'myproject');
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'info');
    assert.equal(event.data['action'], 'store');
    assert.equal(event.data['provider'], 'openai');
    assert.equal(event.data['keyName'], 'default');
    assert.equal(event.data['project'], 'myproject');
    assert.equal(event.data['success'], true);
  });

  // ── getDecrypted() ─────────────────────────────────────

  it('logs audit event on getDecrypted()', () => {
    vault.store('audit-get', 'default', 'sk-secret-value');
    capture.restore();

    // Fresh capture for getDecrypted
    capture = captureAuditLogs();
    vault.getDecrypted('audit-get', 'default');
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'info');
    assert.equal(event.data['action'], 'access');
    assert.equal(event.data['provider'], 'audit-get');
    assert.equal(event.data['success'], true);
  });

  it('logs error event on getDecrypted() when credential missing', () => {
    assert.throws(() => vault.getDecrypted('nonexistent-provider'));
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'error');
    assert.equal(event.data['action'], 'access');
    assert.equal(event.data['success'], false);
    assert.ok(typeof event.data['error'] === 'string');
    assert.ok((event.data['error'] as string).length > 0);
  });

  // ── delete() ───────────────────────────────────────────

  it('logs audit event on delete()', () => {
    const id = vault.store('audit-del', 'default', 'sk-delete-me');
    capture.restore();

    capture = captureAuditLogs();
    vault.delete(id);
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'info');
    assert.equal(event.data['action'], 'delete');
    assert.equal(event.data['provider'], 'audit-del');
    assert.equal(event.data['success'], true);
  });

  it('logs error event on delete() when credential not found', () => {
    assert.throws(() => vault.delete(999999));
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'error');
    assert.equal(event.data['action'], 'delete');
    assert.equal(event.data['success'], false);
    assert.ok((event.data['error'] as string).includes('Credential not found'));
  });

  // ── listMasked() ───────────────────────────────────────

  it('logs audit event on listMasked()', () => {
    vault.listMasked();
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'info');
    assert.equal(event.data['action'], 'list');
    assert.equal(event.data['success'], true);
  });

  // ── storeFile() ────────────────────────────────────────

  it('logs audit event on storeFile()', () => {
    vault.storeFile('opencode', 'auth.json', '{"token":"secret"}', 'myproject');
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'info');
    assert.equal(event.data['action'], 'store_file');
    assert.equal(event.data['provider'], 'opencode');
    assert.equal(event.data['fileName'], 'auth.json');
    assert.equal(event.data['project'], 'myproject');
    assert.equal(event.data['success'], true);
  });

  // ── deleteFile() ───────────────────────────────────────

  it('logs audit event on deleteFile()', () => {
    const id = vault.storeFile('audit-file-del', 'config.json', '{}');
    capture.restore();

    capture = captureAuditLogs();
    vault.deleteFile(id);
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'info');
    assert.equal(event.data['action'], 'delete_file');
    assert.equal(event.data['provider'], 'audit-file-del');
    assert.equal(event.data['success'], true);
  });

  it('logs error event on deleteFile() when file not found', () => {
    assert.throws(() => vault.deleteFile(999999));
    capture.restore();

    assert.equal(capture.logs.length, 1);
    const event = capture.logs[0]!;
    assert.equal(event.level, 'error');
    assert.equal(event.data['action'], 'delete_file');
    assert.equal(event.data['success'], false);
    assert.ok((event.data['error'] as string).includes('File not found'));
  });

  // ── Security: NEVER log decrypted values ───────────────

  it('NEVER logs decrypted API key values in any audit event', () => {
    const secretKey = 'sk-super-secret-api-key-that-must-never-appear-in-logs';

    // Store it
    vault.store('security-test', 'default', secretKey);

    // Access it
    vault.getDecrypted('security-test', 'default');

    // List
    vault.listMasked();

    capture.restore();

    // Check ALL captured logs
    for (const log of capture.logs) {
      const serialized = JSON.stringify(log.data);
      assert.ok(
        !serialized.includes(secretKey),
        `Decrypted value leaked in audit log! Action: ${log.data['action']}`,
      );
      // Also ensure no partial secret leaks
      assert.ok(
        !serialized.includes('super-secret-api-key'),
        `Partial decrypted value leaked in audit log! Action: ${log.data['action']}`,
      );
    }
  });

  it('NEVER logs decrypted file content in any audit event', () => {
    const secretContent = 'top-secret-file-content-never-log-this';

    vault.storeFile('security-file-test', 'secrets.json', secretContent);
    capture.restore();

    for (const log of capture.logs) {
      const serialized = JSON.stringify(log.data);
      assert.ok(
        !serialized.includes(secretContent),
        `Decrypted file content leaked in audit log! Action: ${log.data['action']}`,
      );
    }
  });
});
