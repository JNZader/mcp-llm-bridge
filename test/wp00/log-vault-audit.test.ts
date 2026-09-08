import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Vault, vaultAuditLogger } from '../../src/vault/vault.js';
import { createLogger } from '../../src/core/logger.js';

// Imports compute OAuth paths but never invoke readers. Every Vault uses SQLite
// :memory: and a synthetic key; no credential files or provider calls are used.
const CANARY = 'synthetic-audit-exception-canary';
const PROVIDER = 'synthetic-provider';
const PROJECT = 'synthetic-project';
const KEY = 'synthetic-key';
const FILE = 'synthetic-file.txt';
const MESSAGE = 'An unexpected internal error occurred.';
const operations = [
  { action: 'store', invoke: (vault: Vault) => vault.store(PROVIDER, KEY, 'synthetic-secret', PROJECT),
    metadata: { provider: PROVIDER, keyName: KEY, project: PROJECT } },
  { action: 'access', invoke: (vault: Vault) => vault.getDecrypted(PROVIDER, KEY, PROJECT),
    metadata: { provider: PROVIDER, keyName: KEY, project: PROJECT } },
  { action: 'list', invoke: (vault: Vault) => vault.listMasked(PROJECT),
    metadata: { provider: '*', project: PROJECT } },
  { action: 'store_file', invoke: (vault: Vault) => vault.storeFile(PROVIDER, FILE, 'synthetic-content', PROJECT),
    metadata: { provider: PROVIDER, fileName: FILE, project: PROJECT } },
];

describe('LOG-OPERATIONS Vault audit exception identity', { concurrency: false }, () => {
  for (const operation of operations) {
    for (const scenario of ['error', 'string', 'getter', 'coercion', 'proxy', 'revoked', 'null']) {
      it(operation.action + ' preserves ' + scenario + ' and emits one finite failure audit', (t) => {
        const key = Buffer.alloc(32, 7);
        const vault = new Vault({ dbPath: ':memory:', masterKey: key, httpPort: 0 });
        const db = vault.getDb();
        const events: unknown[] = [];
        const success: unknown[] = [];
        const output: string[] = [];
        const pino = createLogger({ pretty: false, level: 'trace' }, {
          write(line: string) { output.push(line); },
        }).child({ component: 'vault-audit' });
        const errorLog = t.mock.method(vaultAuditLogger, 'error', (event: unknown) => {
          events.push(event);
          pino.error(event);
        });
        const infoLog = t.mock.method(vaultAuditLogger, 'info', (event: unknown) => { success.push(event); });
        let inspections = 0;
        const inspect = () => { inspections++; throw new Error('inspection-replacement'); };
        let failure: unknown;
        switch (scenario) {
          case 'error': failure = new Error(CANARY); break;
          case 'string': failure = CANARY; break;
          case 'getter': {
            const error = new Error();
            Object.defineProperty(error, 'message', { get: inspect });
            failure = error;
            break;
          }
          case 'coercion': failure = { toString: inspect, [Symbol.toPrimitive]: inspect }; break;
          case 'proxy': failure = new Proxy({}, { getPrototypeOf: inspect, get: inspect }); break;
          case 'revoked': {
            const revoked = Proxy.revocable({}, {});
            revoked.revoke();
            failure = revoked.proxy;
            break;
          }
          case 'null': failure = null; break;
          default: assert.fail('Unknown scenario');
        }
        const prepare = t.mock.method(db, 'prepare', () => { throw failure; });
        try {
          let caught: unknown;
          let threw = false;
          try { operation.invoke(vault); }
          catch (error) { threw = true; caught = error; }
          assert.equal(prepare.mock.callCount(), 1);
          prepare.mock.restore();
          assert.deepEqual(db.prepare('SELECT * FROM credentials').all(), []);
          assert.deepEqual(db.prepare('SELECT * FROM files').all(), []);
          assert.equal(threw, true);
          // Boolean identity avoids diagnostic formatting of a hostile object.
          assert.equal(Object.is(caught, failure), true);
          assert.equal(inspections, 0);
          assert.deepEqual(success, []);
          assert.deepEqual(events, [{
            action: operation.action, ...operation.metadata, success: false, error: MESSAGE,
          }]);
          assert.equal(output.length, 1);
          assert.equal(output.join('').includes(CANARY), false);
          const entry: Record<string, unknown> = JSON.parse(output[0]!);
          const { pid, hostname, time, ...event } = entry;
          assert.equal(typeof pid, 'number');
          assert.equal(typeof hostname, 'string');
          assert.equal(typeof time, 'number');
          // Pino already redacts error. This regression targets normalization,
          // missing audits and replaced exceptions, not a new serialized leak.
          assert.deepEqual(event, {
            level: 50, component: 'vault-audit', action: operation.action,
            ...operation.metadata, success: false, error: '[REDACTED]',
          });
        } finally {
          prepare.mock.restore();
          errorLog.mock.restore();
          infoLog.mock.restore();
          vault.destroy();
          assert.equal(vault.destroyed, true);
          assert.equal(key.every((byte) => byte === 0), true);
          assert.equal(db.open, false);
        }
      });
    }
  }

  it('preserves real credential and file CRUD plus successful audit metadata', (t) => {
    const key = Buffer.alloc(32, 9);
    const vault = new Vault({ dbPath: ':memory:', masterKey: key, httpPort: 0 });
    const events: unknown[] = [];
    const errors: unknown[] = [];
    const info = t.mock.method(vaultAuditLogger, 'info', (event: unknown) => { events.push(event); });
    const error = t.mock.method(vaultAuditLogger, 'error', (event: unknown) => { errors.push(event); });
    try {
      const id = vault.store(PROVIDER, KEY, 'synthetic-secret', PROJECT);
      assert.equal(typeof id, 'number');
      assert.equal(vault.getDecrypted(PROVIDER, KEY, PROJECT), 'synthetic-secret');
      const rows = vault.listMasked(PROJECT);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.id, id);
      const fileId = vault.storeFile(PROVIDER, FILE, 'synthetic-content', PROJECT);
      assert.equal(vault.getFile(PROVIDER, FILE, PROJECT), 'synthetic-content');
      assert.deepEqual(events, operations.map(({ action, metadata }) => ({ action, ...metadata, success: true })));
      vault.delete(id, PROJECT);
      vault.deleteFile(fileId, PROJECT);
      assert.deepEqual(vault.listMasked(PROJECT), []);
      assert.equal(vault.getFile(PROVIDER, FILE, PROJECT), null);
      assert.deepEqual(errors, []);
    } finally {
      info.mock.restore();
      error.mock.restore();
      vault.destroy();
      assert.equal(key.every((byte) => byte === 0), true);
      assert.equal(vault.getDb().open, false);
    }
  });
});
