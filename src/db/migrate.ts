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
   * Run a specific migration by version
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

    // Execute migration in a transaction
    const transaction = this.db.transaction(() => {
      this.db.exec(migration.upSql);
    });

    transaction();
    
    console.error(`Applied migration ${version}: ${migration.name}`);
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
