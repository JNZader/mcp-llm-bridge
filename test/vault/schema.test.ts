import assert from 'node:assert';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import {
  evaluateStorageMigrationGates,
  initializeDb,
  STORAGE_MIGRATION_GATE,
  STORAGE_MIGRATION_GATE_STATUS,
} from '../../src/vault/schema.js';

describe('protected storage schema', () => {
  it('creates protected request and comparison tables for fresh databases', () => {
    const db = new Database(':memory:');
    try {
      initializeDb(db);
      const requestColumns = db.pragma('table_info(request_logs)') as Array<{ name: string }>;
      const usageColumns = db.pragma('table_info(usage_logs)') as Array<{ name: string }>;
      const comparisonColumns = db.pragma('table_info(comparison_results)') as Array<{ name: string }>;
      assert.deepStrictEqual(requestColumns.some(({ name }) => name === 'request_data'), false);
      assert.deepStrictEqual(requestColumns.some(({ name }) => name === 'error'), true);
      for (const rawUsageColumn of ['key_name', 'project', 'user_id', 'error_message']) {
        assert.deepStrictEqual(usageColumns.some(({ name }) => name === rawUsageColumn), false);
      }
      assert.deepStrictEqual(comparisonColumns.some(({ name }) => name === 'prompt'), false);
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'authorized_comparison_results'").get());
    } finally {
      db.close();
    }
  });

  it('evaluates forward and rollback gates independently and fails closed on incomplete evidence', () => {
    for (const gate of Object.values(STORAGE_MIGRATION_GATE)) {
      const result = evaluateStorageMigrationGates({
        forward: { [gate]: STORAGE_MIGRATION_GATE_STATUS.FAILED },
        rollback: { [gate]: STORAGE_MIGRATION_GATE_STATUS.VERIFIED },
      });
      assert.strictEqual(result.forward.gates[gate], STORAGE_MIGRATION_GATE_STATUS.FAILED);
      assert.strictEqual(result.rollback.gates[gate], STORAGE_MIGRATION_GATE_STATUS.VERIFIED);
      assert.strictEqual(result.isFullyVerified, false);
    }
    const incomplete = evaluateStorageMigrationGates({
      forward: { [STORAGE_MIGRATION_GATE.RAW_WRITE_REJECTION]: STORAGE_MIGRATION_GATE_STATUS.VERIFIED },
      rollback: { [STORAGE_MIGRATION_GATE.RAW_WRITE_REJECTION]: STORAGE_MIGRATION_GATE_STATUS.VERIFIED },
    });
    assert.strictEqual(incomplete.forward.gates[STORAGE_MIGRATION_GATE.ROUTINE_READBACK_DENIAL], STORAGE_MIGRATION_GATE_STATUS.NOT_VERIFIED);
    assert.strictEqual(incomplete.rollback.gates[STORAGE_MIGRATION_GATE.ROUTINE_READBACK_DENIAL], STORAGE_MIGRATION_GATE_STATUS.NOT_VERIFIED);
    assert.strictEqual(incomplete.isFullyVerified, false);
    const indeterminate = evaluateStorageMigrationGates({
      forward: { [STORAGE_MIGRATION_GATE.LEGACY_ISOLATION]: STORAGE_MIGRATION_GATE_STATUS.INDETERMINATE },
      rollback: { [STORAGE_MIGRATION_GATE.LEGACY_ISOLATION]: STORAGE_MIGRATION_GATE_STATUS.VERIFIED },
    });
    assert.strictEqual(indeterminate.forward.gates[STORAGE_MIGRATION_GATE.LEGACY_ISOLATION], STORAGE_MIGRATION_GATE_STATUS.INDETERMINATE);
    assert.strictEqual(indeterminate.rollback.gates[STORAGE_MIGRATION_GATE.LEGACY_ISOLATION], STORAGE_MIGRATION_GATE_STATUS.VERIFIED);
    assert.strictEqual(indeterminate.isFullyVerified, false);

    const allVerified = Object.fromEntries(
      Object.values(STORAGE_MIGRATION_GATE).map((gate) => [gate, STORAGE_MIGRATION_GATE_STATUS.VERIFIED]),
    ) as Record<(typeof STORAGE_MIGRATION_GATE)[keyof typeof STORAGE_MIGRATION_GATE], (typeof STORAGE_MIGRATION_GATE_STATUS)[keyof typeof STORAGE_MIGRATION_GATE_STATUS]>;
    const fullyVerified = evaluateStorageMigrationGates({ forward: allVerified, rollback: allVerified });
    assert.strictEqual(fullyVerified.forward.isFullyVerified, true);
    assert.strictEqual(fullyVerified.rollback.isFullyVerified, true);
    assert.strictEqual(fullyVerified.isFullyVerified, true);
  });
});
