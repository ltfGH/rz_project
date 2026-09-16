import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { AppError } from '../shared/errors';
import type { CompiledSchema, Migration } from './schema-compiler';

export interface DatabaseOptions {
  readonly filename: string;
  readonly busyTimeoutMs?: number;
}

export interface RuntimeDatabase {
  migrate(schema: CompiledSchema): void;
  transaction<T>(action: (connection: DatabaseSync) => T): T;
  prepare(sql: string): StatementSync;
  integrityCheck(): boolean;
  close(): void;
}

function hasMigrationTable(connection: DatabaseSync): boolean {
  const row = connection.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='sys_migration'"
  ).get() as { count: number };
  return row.count === 1;
}

function currentVersion(connection: DatabaseSync): number {
  if (!hasMigrationTable(connection)) return 0;
  const row = connection.prepare(
    'SELECT COALESCE(MAX(version), 0) AS version FROM sys_migration'
  ).get() as { version: number };
  return row.version;
}

class SQLiteRuntimeDatabase implements RuntimeDatabase {
  readonly #connection: DatabaseSync;
  #closed = false;

  constructor(options: DatabaseOptions) {
    this.#connection = new DatabaseSync(options.filename);
    const timeout = options.busyTimeoutMs ?? 5000;
    if (!Number.isInteger(timeout) || timeout < 0) {
      this.#connection.close();
      throw new AppError('VALIDATION_FAILED', 'Database busy timeout must be a non-negative integer.');
    }
    this.#connection.exec(`PRAGMA busy_timeout = ${timeout};`);
    this.#connection.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(sql: string): StatementSync {
    this.#assertOpen();
    return this.#connection.prepare(sql);
  }

  transaction<T>(action: (connection: DatabaseSync) => T): T {
    this.#assertOpen();
    this.#connection.exec('BEGIN IMMEDIATE;');
    try {
      const result = action(this.#connection);
      this.#connection.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.#connection.exec('ROLLBACK;');
      } catch {
        // Preserve the operation error; a later integrity check reports connection damage.
      }
      throw error;
    }
  }

  migrate(schema: CompiledSchema): void {
    this.#assertOpen();
    const installedVersion = currentVersion(this.#connection);
    if (installedVersion > schema.version) {
      throw new AppError(
        'DATABASE_MIGRATION_FAILED',
        `Database schema ${installedVersion} is newer than supported version ${schema.version}.`
      );
    }
    for (const migration of schema.migrations) {
      if (migration.version <= installedVersion) continue;
      this.#applyMigration(migration, schema.digest);
    }
  }

  integrityCheck(): boolean {
    this.#assertOpen();
    const row = this.#connection.prepare('PRAGMA integrity_check').get() as {
      integrity_check: string;
    };
    return row.integrity_check === 'ok';
  }

  close(): void {
    if (this.#closed) return;
    this.#connection.close();
    this.#closed = true;
  }

  #applyMigration(migration: Migration, schemaDigest: string): void {
    try {
      this.transaction((connection) => {
        for (const statement of migration.statements) connection.exec(statement);
        connection.prepare(
          'INSERT INTO sys_migration (version, name, digest, applied_at) VALUES (?, ?, ?, ?)'
        ).run(migration.version, migration.name, schemaDigest, new Date().toISOString());
      });
    } catch (cause) {
      throw new AppError(
        'DATABASE_MIGRATION_FAILED',
        `Database migration ${migration.version} failed.`,
        { cause }
      );
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new AppError('INTERNAL_ERROR', 'Database connection is closed.');
  }
}

export function openDatabase(options: DatabaseOptions): RuntimeDatabase {
  return new SQLiteRuntimeDatabase(options);
}
