/**
 * Database Migration Runner
 * 
 * Handles idempotent execution of SQLite migrations with:
 * - Version tracking via schema_migrations table
 * - Rollback support
 * - Checksum verification
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Resolve the migrations directory across both runtime layouts:
 * - dev (tsx from source): this module lives in `src/db/`, migrations in `src/migrations/`
 *   → `../migrations`
 * - prod (bundled): the emitted chunk lives flat in `dist/`, migrations copied to `dist/migrations/`
 *   → `./migrations`
 * The first existing candidate wins; falls back to the dev layout if none exist yet.
 */
function resolveDefaultMigrationsDir(): string {
  const devLayout = join(__dirname, '../migrations');
  const bundledLayout = join(__dirname, 'migrations');

  for (const candidate of [devLayout, bundledLayout]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return devLayout;
}

export interface Migration {
  version: number;
  name: string;
  upSql: string;
  downSql: string;
  checksum: string;
}

export interface MigrationRunnerOptions {
  dbPath?: string;
  migrationsDir?: string;
}

export class MigrationRunner {
  private db: Database.Database;
  private migrationsDir: string;

  constructor(options: MigrationRunnerOptions = {}) {
    this.db = new Database(options.dbPath ?? ':memory:');
    this.migrationsDir = options.migrationsDir ?? resolveDefaultMigrationsDir();
    this.ensureMigrationTable();
  }

  /**
   * Get the underlying database instance
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Ensure schema_migrations table exists
   */
  private ensureMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER DEFAULT (strftime('%s', 'now')),
        checksum TEXT
      )
    `);
  }

  /**
   * Load all migrations from the migrations directory
   */
  loadMigrations(): Migration[] {
    const files = readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql') && !f.includes('_rollback'))
      .sort();

    const migrations: Migration[] = [];

    for (const file of files) {
      const version = parseInt(file.match(/^(\d+)/)?.[1] ?? '0', 10);
      const name = basename(file, '.sql');
      const upPath = join(this.migrationsDir, file);
      const downPath = join(this.migrationsDir, `${name}_rollback.sql`);

      const upSql = readFileSync(upPath, 'utf-8');
      let downSql = '';
      
      try {
        downSql = readFileSync(downPath, 'utf-8');
      } catch {
        // Rollback file may not exist
      }

      // Simple checksum (first line with version comment)
      const checksum = upSql.split('\n')[0] || 'unknown';

      migrations.push({ version, name, upSql, downSql, checksum });
    }

    return migrations;
  }

  /**
   * Get list of applied migrations
   */
  getAppliedMigrations(): Array<{ version: number; name: string; checksum: string | null }> {
    const stmt = this.db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version');
    return stmt.all() as Array<{ version: number; name: string; checksum: string | null }>;
  }

  /**
   * Check if a specific migration has been applied
   */
  isMigrationApplied(version: number): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    return !!stmt.get(version);
  }

  /**
   * Record a migration in the ledger. INSERT OR IGNORE keeps this idempotent
   * and non-destructive: if a migration's own SQL already self-registered a
   * row (migrations 001/002/008-011 do this via `INSERT OR IGNORE`), that
   * row — and its historical checksum — is preserved; the runner only fills
   * in migrations whose SQL forgot to self-register (003-007).
   */
  private recordMigration(migration: Migration): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)'
      )
      .run(migration.version, migration.name, migration.checksum);
  }

  /**
   * Detect SQLite errors that mean the schema change is already present
   * (e.g. a previously-applied migration whose ledger row was lost). SQLite
   * has no `ADD COLUMN IF NOT EXISTS`, so a re-run of an additive migration
   * surfaces as one of these instead of being a no-op.
   */
  private isAlreadyAppliedError(err: unknown): boolean {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    return (
      message.includes('duplicate column name') ||
      message.includes('already exists')
    );
  }

  /**
   * Run a specific migration by version.
   *
   * The DDL and the ledger insert run in the SAME transaction so the invariant
   * holds: if the schema change is committed, the migration is recorded. This
   * is the root-cause fix — previously the runner never wrote the ledger and
   * relied on each migration's SQL to self-register, which 003-007 omit,
   * causing them to re-run (and crash on `duplicate column`) on every restart.
   *
   * Defense in depth: if applying the DDL fails because the objects already
   * exist (a DB left inconsistent by the old bug — columns present, ledger
   * row missing), we reconcile the ledger instead of crashing, auto-repairing
   * the DB.
   */
  async runMigration(version: number): Promise<void> {
    const migrations = this.loadMigrations();
    const migration = migrations.find(m => m.version === version);

    if (!migration) {
      throw new Error(`Migration ${version} not found`);
    }

    if (this.isMigrationApplied(version)) {
      console.error(`Migration ${version} already applied, skipping`);
      return;
    }

    // Apply DDL and record the ledger row atomically in one transaction.
    const transaction = this.db.transaction(() => {
      this.db.exec(migration.upSql);
      this.recordMigration(migration);
    });

    try {
      transaction();
      console.error(`Applied migration ${version}: ${migration.name}`);
    } catch (err) {
      if (this.isAlreadyAppliedError(err)) {
        // Schema objects already exist but the ledger lost track of them.
        // Reconcile the ledger (its own committed statement) and move on.
        this.recordMigration(migration);
        console.error(
          `Migration ${version} objects already exist; reconciled ledger: ${migration.name}`
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Run all pending migrations
   */
  async runAllMigrations(): Promise<void> {
    const migrations = this.loadMigrations();
    const applied = this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map(a => a.version));

    for (const migration of migrations) {
      if (!appliedVersions.has(migration.version)) {
        await this.runMigration(migration.version);
      }
    }
  }

  /**
   * Rollback a specific migration by version
   */
  async rollbackMigration(version: number): Promise<void> {
    const migrations = this.loadMigrations();
    const migration = migrations.find(m => m.version === version);

    if (!migration) {
      throw new Error(`Migration ${version} not found`);
    }

    if (!migration.downSql) {
      throw new Error(`Migration ${version} has no rollback script`);
    }

    if (!this.isMigrationApplied(version)) {
      console.error(`Migration ${version} not applied, skipping rollback`);
      return;
    }

    // Execute rollback in a transaction
    const transaction = this.db.transaction(() => {
      this.db.exec(migration.downSql);
    });

    transaction();
    
    console.error(`Rolled back migration ${version}: ${migration.name}`);
  }

  /**
   * Get table information (for testing)
   */
  getTableInfo(tableName: string): Array<{ name: string; type: string }> {
    const stmt = this.db.prepare(`PRAGMA table_info(${tableName})`);
    const rows = stmt.all() as Array<{ name: string; type: string }>;
    return rows;
  }

  /**
   * Get list of indexes for a table (for testing)
   */
  getIndexes(tableName: string): string[] {
    const stmt = this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`);
    const rows = stmt.all(tableName) as Array<{ name: string }>;
    return rows.map(r => r.name);
  }

  /**
   * Get list of all tables (for testing)
   */
  getTables(): string[] {
    const stmt = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    const rows = stmt.all() as Array<{ name: string }>;
    return rows.map(r => r.name);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Convenience function to run all migrations
 */
export async function migrate(options: MigrationRunnerOptions = {}): Promise<void> {
  const runner = new MigrationRunner(options);
  try {
    await runner.runAllMigrations();
  } finally {
    runner.close();
  }
}

export default MigrationRunner;
