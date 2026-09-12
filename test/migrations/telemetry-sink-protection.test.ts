import assert from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MigrationRunner } from '../../src/db/migrate.js';
import { RequestLogger } from '../../src/logging/request-logger.js';
import { initializeDb } from '../../src/vault/schema.js';

describe('Migration 012: storage legacy isolation', () => {
  let runner: MigrationRunner;

  beforeEach(async () => {
    runner = new MigrationRunner({ dbPath: ':memory:' });
    await runner.runMigration(1);
    await runner.runMigration(7);
    const db = runner.getDatabase();
    db.exec(`
      INSERT INTO request_logs (timestamp, provider, model, error, request_data, response_data)
      VALUES (1, 'provider', 'model', 'legacy-error', 'request-canary', 'response-canary');
      INSERT INTO comparison_results (id, prompt, models, results, summary)
      VALUES ('legacy-comparison', 'prompt-canary', '[]', 'results-canary', 'summary-canary');
    `);
  });

  afterEach(() => runner.close());

  it('isolates legacy rows and rejects raw writes from protected storage', async () => {
    await runner.runMigration(12);
    const db = runner.getDatabase();
    const requestColumns = runner.getTableInfo('request_logs').map(({ name }) => name);
    const usageColumns = runner.getTableInfo('usage_logs').map(({ name }) => name);
    const comparisonColumns = runner.getTableInfo('comparison_results').map(({ name }) => name);

    assert.deepStrictEqual(requestColumns.includes('request_data'), false);
    assert.deepStrictEqual(requestColumns.includes('response_data'), false);
    assert.deepStrictEqual(requestColumns.includes('error'), true);
    for (const rawUsageColumn of ['key_name', 'project', 'user_id', 'error_message']) {
      assert.deepStrictEqual(usageColumns.includes(rawUsageColumn), false);
    }
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_logs_legacy'").get());
    assert.deepStrictEqual(comparisonColumns.includes('prompt'), false);
    assert.deepStrictEqual(comparisonColumns.includes('system_prompt'), false);
    assert.deepStrictEqual(comparisonColumns.includes('results'), false);
    assert.deepStrictEqual(comparisonColumns.includes('summary'), false);
    assert.match(String(db.prepare('SELECT request_data FROM request_logs_legacy').pluck().get()), /request-canary/);
    assert.throws(() => db.prepare("INSERT INTO request_logs (timestamp, provider, model, request_data) VALUES (2, 'p', 'm', 'raw')").run());
  });

  it('captures normalized request failures after the protected migration', async () => {
    await runner.runMigration(12);
    initializeDb(runner.getDatabase());
    const logger = new RequestLogger(runner.getDatabase());
    await logger.capture({ provider: 'openai', model: 'gpt-4o', latencyMs: 1, error: 'provider raw failure' });
    const row = runner.getDatabase().prepare('SELECT error, error_code, error_category FROM request_logs').get() as {
      error: string;
      error_code: string;
      error_category: string;
    };
    assert.deepStrictEqual(row, { error: 'failed', error_code: 'failed', error_category: 'client' });
  });

  it('keeps new comparison content in the authorized storage boundary', async () => {
    await runner.runMigration(12);
    const db = runner.getDatabase();
    db.exec(`
      INSERT INTO comparison_results (id, models, project) VALUES ('authorized', '[]', '_global');
      INSERT INTO authorized_comparison_results (id, prompt, results, summary)
      VALUES ('authorized', 'prompt', 'results', 'summary');
    `);
    assert.strictEqual(db.prepare('SELECT prompt FROM authorized_comparison_results WHERE id = ?').pluck().get('authorized'), 'prompt');
    assert.strictEqual(db.prepare('SELECT * FROM comparison_results WHERE id = ?').get('legacy-comparison'), undefined);
  });

  it('keeps routine tables protected after rollback and safely re-rolls back', async () => {
    await runner.runMigration(12);
    await runner.rollbackMigration(12);
    assert.equal(runner.getTableInfo('request_logs').some(({ name }) => name === 'request_data'), false);
    assert.equal(runner.getTableInfo('comparison_results').some(({ name }) => name === 'prompt'), false);
    assert.ok(runner.getTableInfo('authorized_comparison_results_rollback_archive').some(({ name }) => name === 'prompt'));
    assert.ok(runner.getTableInfo('request_logs_legacy').some(({ name }) => name === 'request_data'));
    assert.strictEqual(runner.getAppliedMigrations().some(({ version }) => version === 12), false);
    await assert.doesNotReject(() => runner.rollbackMigration(12));
  });
});
