import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDatabase, type RuntimeDatabase } from '../../src/core/database';
import type { CompiledSchema } from '../../src/core/schema-compiler';
import { AppError } from '../../src/shared/errors';

function testDatabase(t: test.TestContext): RuntimeDatabase {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-database-'));
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

function schema(statements: readonly string[]): CompiledSchema {
  return {
    version: 1,
    digest: 'schema-digest',
    migrations: [{ version: 1, name: 'initial', statements }],
    entityTables: {},
    systemTables: ['sys_migration']
  };
}

const migrationStatements = [
  'CREATE TABLE "sys_migration" ("version" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "digest" TEXT NOT NULL, "applied_at" TEXT NOT NULL);',
  'CREATE TABLE "parent" ("id" INTEGER PRIMARY KEY);',
  'CREATE TABLE "child" ("id" INTEGER PRIMARY KEY, "parent_id" INTEGER NOT NULL, FOREIGN KEY ("parent_id") REFERENCES "parent" ("id") ON DELETE RESTRICT);'
];

test('enables foreign keys and applies each migration exactly once', (t) => {
  const database = testDatabase(t);

  database.migrate(schema(migrationStatements));
  database.migrate(schema(migrationStatements));

  const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  const migrations = database.prepare('SELECT COUNT(*) AS count FROM sys_migration').get() as { count: number };
  assert.equal(foreignKeys.foreign_keys, 1);
  assert.equal(migrations.count, 1);
  assert.throws(
    () => database.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(1, 999),
    /FOREIGN KEY constraint failed/
  );
  assert.equal(database.integrityCheck(), true);
});

test('refuses databases newer than the application schema', (t) => {
  const database = testDatabase(t);
  database.migrate(schema(migrationStatements));
  database.prepare(
    'INSERT INTO sys_migration (version, name, digest, applied_at) VALUES (?, ?, ?, ?)'
  ).run(2, 'future', 'future-digest', new Date().toISOString());

  assert.throws(
    () => database.migrate(schema(migrationStatements)),
    (error: unknown) => error instanceof AppError && error.code === 'DATABASE_MIGRATION_FAILED'
  );
});

test('rolls back every statement when a migration fails', (t) => {
  const database = testDatabase(t);
  const broken = schema([
    migrationStatements[0]!,
    'CREATE TABLE "partial" ("id" INTEGER PRIMARY KEY);',
    'THIS IS NOT SQL;'
  ]);

  assert.throws(
    () => database.migrate(broken),
    (error: unknown) => error instanceof AppError && error.code === 'DATABASE_MIGRATION_FAILED'
  );
  const partial = database.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='partial'"
  ).get() as { count: number };
  assert.equal(partial.count, 0);
});

test('rolls back application transactions when the callback throws', (t) => {
  const database = testDatabase(t);
  database.migrate(schema(migrationStatements));

  assert.throws(() => database.transaction((connection) => {
    connection.prepare('INSERT INTO parent (id) VALUES (?)').run(1);
    throw new Error('stop');
  }), /stop/);

  const rows = database.prepare('SELECT COUNT(*) AS count FROM parent').get() as { count: number };
  assert.equal(rows.count, 0);
});

test('system Node and Electron expose the required SQLite primitives', () => {
  const systemProbe = spawnSync(process.execPath, ['-e', [
    "const sqlite=require('node:sqlite')",
    "if(!sqlite.DatabaseSync||!sqlite.backup)process.exit(2)",
    "const db=new sqlite.DatabaseSync(':memory:')",
    "db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY)')",
    "db.exec('BEGIN IMMEDIATE;ROLLBACK')",
    "if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')process.exit(3)",
    'db.close()'
  ].join(';')], { encoding: 'utf8', windowsHide: true });
  assert.equal(systemProbe.status, 0, systemProbe.stderr);

  const electronPath = require('electron') as string;
  const electronProbe = spawnSync(electronPath, ['-e', [
    "const sqlite=require('node:sqlite')",
    "if(!sqlite.DatabaseSync||!sqlite.backup)process.exit(2)",
    "const db=new sqlite.DatabaseSync(':memory:')",
    "db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY)')",
    "db.exec('BEGIN IMMEDIATE;ROLLBACK')",
    "if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')process.exit(3)",
    'db.close()'
  ].join(';')], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  assert.equal(electronProbe.status, 0, electronProbe.stderr);
});
