import assert from 'node:assert/strict';
import { Console } from 'node:console';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, it, type TestContext } from 'node:test';
import { createLogger, logger } from '../../src/core/logger.js';
import { MigrationRunner } from '../../src/db/migrate.js';

const CANARY = 'private-migration-canary';
const APPLIED = 'Migration applied.';
const SKIPPED = 'Migration already applied; skipping.';
const RECONCILED = 'Migration objects already exist; ledger reconciled.';
const ROLLED_BACK = 'Migration rolled back.';
const NO_ROLLBACK = 'Migration not applied; skipping rollback.';

interface Fixture {
  runner: MigrationRunner;
  output: string[];
  raw: string[];
  migration: (version: number, up: string, down?: string) => void;
}

async function fixture(t: TestContext, run: (value: Fixture) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), CANARY + '-'));
  const raw: string[] = [];
  const output: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) { raw.push(chunk.toString()); done(); },
  });
  const originalConsole = new Console({ stdout: stream, stderr: stream });
  const pino = createLogger({ pretty: false, level: 'trace' }, {
    write(line: string) { output.push(line); },
  });
  const consoleMock = t.mock.method(console, 'error', originalConsole.error.bind(originalConsole));
  const loggerMock = t.mock.method(logger, 'error', pino.error.bind(pino));
  let runner: MigrationRunner | undefined;
  try {
    runner = new MigrationRunner({ dbPath: ':memory:', migrationsDir: dir });
    await run({ runner, output, raw, migration(version, up, down) {
      const name = String(version).padStart(3, '0') + '_' + CANARY;
      writeFileSync(join(dir, name + '.sql'), '-- ' + CANARY + '\n' + up);
      if (down !== undefined) writeFileSync(join(dir, name + '_rollback.sql'), down);
    } });
  } finally {
    try { runner?.close(); }
    finally {
      loggerMock.mock.restore();
      consoleMock.mock.restore();
      stream.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function events(f: Fixture, expected: Record<string, unknown>[]) {
  // Inspect actual Console bytes separately; never sanitize the baseline
  // through Pino before checking names, paths, SQL and checksum canaries.
  assert.equal(f.raw.join('').includes(CANARY), false);
  assert.deepEqual(f.raw, []);
  assert.equal(f.output.join('').includes(CANARY), false);
  assert.equal(f.output.length, expected.length);
  const actual = f.output.map((line) => {
    const entry: Record<string, unknown> = JSON.parse(line);
    const { pid, hostname, time, ...event } = entry;
    assert.equal(typeof pid, 'number');
    assert.equal(typeof hostname, 'string');
    assert.equal(typeof time, 'number');
    return event;
  });
  assert.deepEqual(actual, expected.map((event) => ({ level: 50, ...event })));
}

describe('LOG-OPERATIONS migration diagnostics', { concurrency: false }, () => {
  it('preserves ordered application and idempotency without logging migration identities', async (t) => {
    await fixture(t, async (f) => {
      f.migration(2, 'INSERT INTO items VALUES (2);');
      f.migration(1, 'CREATE TABLE items(value INTEGER); INSERT INTO items VALUES (1);');
      await f.runner.runAllMigrations();
      await f.runner.runMigration(1);
      await f.runner.runAllMigrations();
      assert.deepEqual(f.runner.getDatabase().prepare('SELECT value FROM items ORDER BY rowid').all(),
        [{ value: 1 }, { value: 2 }]);
      assert.deepEqual(f.runner.getAppliedMigrations(), [1, 2].map((version) => ({
        version, name: String(version).padStart(3, '0') + '_' + CANARY, checksum: '-- ' + CANARY,
      })));
      events(f, [{ msg: APPLIED, version: 1 }, { msg: APPLIED, version: 2 }, { msg: SKIPPED, version: 1 }]);
    });
  });

  it('reconciles an existing object without losing the original table data', async (t) => {
    await fixture(t, async (f) => {
      f.migration(1, 'CREATE TABLE items(value INTEGER);');
      f.runner.getDatabase().exec('CREATE TABLE items(value INTEGER); INSERT INTO items VALUES (7);');
      await f.runner.runMigration(1);
      assert.equal(f.runner.isMigrationApplied(1), true);
      assert.deepEqual(f.runner.getDatabase().prepare('SELECT value FROM items').all(), [{ value: 7 }]);
      events(f, [{ msg: RECONCILED, version: 1 }]);
    });
  });

  it('retains rollback SQL ownership of ledger deletion and the unapplied skip', async (t) => {
    await fixture(t, async (f) => {
      f.migration(1, 'CREATE TABLE items(value INTEGER);',
        'DROP TABLE items; DELETE FROM schema_migrations WHERE version = 1;');
      await f.runner.runMigration(1);
      await f.runner.rollbackMigration(1);
      await f.runner.rollbackMigration(1);
      assert.equal(f.runner.getTables().includes('items'), false);
      assert.equal(f.runner.isMigrationApplied(1), false);
      events(f, [{ msg: APPLIED, version: 1 }, { msg: ROLLED_BACK, version: 1 }, { msg: NO_ROLLBACK, version: 1 }]);
    });
  });

  it('rolls back partial up SQL on failure without a success event', async (t) => {
    await fixture(t, async (f) => {
      f.migration(1, 'CREATE TABLE items(value INTEGER); INSERT INTO "missing_' + CANARY + '" VALUES (1);');
      await assert.rejects(f.runner.runMigration(1), /no such table/);
      assert.equal(f.runner.getTables().includes('items'), false);
      assert.deepEqual(f.runner.getAppliedMigrations(), []);
      events(f, []);
    });
  });

  it('rolls back partial down SQL and preserves the applied ledger on failure', async (t) => {
    await fixture(t, async (f) => {
      f.migration(1, 'CREATE TABLE items(value INTEGER);',
        'DROP TABLE items; DELETE FROM schema_migrations WHERE version = 1; INSERT INTO "missing_' + CANARY + '" VALUES (1);');
      await f.runner.runMigration(1);
      f.output.length = 0;
      f.raw.length = 0;
      await assert.rejects(f.runner.rollbackMigration(1), /no such table/);
      assert.equal(f.runner.getTables().includes('items'), true);
      assert.equal(f.runner.isMigrationApplied(1), true);
      events(f, []);
    });
  });

  it('preserves an ordinary database error identity instead of replacing it', async (t) => {
    await fixture(t, async (f) => {
      f.migration(1, 'CREATE TABLE items(value INTEGER);');
      const error = new Error(CANARY);
      const mocked = t.mock.method(f.runner.getDatabase(), 'exec', () => { throw error; });
      try { await assert.rejects(f.runner.runMigration(1), (actual) => actual === error); }
      finally { mocked.mock.restore(); }
      assert.equal(f.runner.isMigrationApplied(1), false);
      events(f, []);
    });
  });

  for (const version of [-1, 0.5, Infinity]) {
    it('defensively omits non-version numeric metadata ' + version, async (t) => {
      await fixture(t, async (f) => {
        // Isolate the log branch through public methods; no claim that SQLite
        // accepts these values or that the migration loader produces them.
        const load = t.mock.method(f.runner, 'loadMigrations', () => [{
          version, name: CANARY, checksum: CANARY, upSql: '', downSql: '',
        }]);
        const applied = t.mock.method(f.runner, 'isMigrationApplied', () => true);
        try {
          await f.runner.runMigration(version);
          events(f, [{ msg: SKIPPED }]);
        } finally { applied.mock.restore(); load.mock.restore(); }
      });
    });
  }
});
