import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AuditService } from '../../src/core/audit-service';
import {
  BackupService,
  type DatabaseController
} from '../../src/core/backup-service';
import { openDatabase, type RuntimeDatabase } from '../../src/core/database';
import { PermissionService } from '../../src/core/permission-service';
import { compileSchema } from '../../src/core/schema-compiler';
import type { ActorDto } from '../../src/shared/dto';
import { AppError } from '../../src/shared/errors';
import { repositoryBlueprint } from '../helpers/runtime-fixture';

const maintainer: ActorDto = {
  userId: 1, username: 'admin', displayName: '管理员', roleId: 'maintainer'
};
const viewer: ActorDto = {
  userId: 2, username: 'viewer', displayName: '只读', roleId: 'viewer'
};

function setup(t: test.TestContext, reopenFailureCount = 0) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-service-'));
  const databasePath = path.join(directory, 'runtime.sqlite');
  const backupDirectory = path.join(directory, 'backups');
  const blueprint = repositoryBlueprint();
  blueprint.roles = [
    { id: 'maintainer', name: '维护员', permissions: ['maintenance.backup', 'maintenance.restore'] },
    { id: 'viewer', name: '只读', permissions: [] }
  ];
  const schema = compileSchema(blueprint);
  let current = openDatabase({ filename: databasePath });
  current.migrate(schema);
  let failures = reopenFailureCount;
  const controller: DatabaseController = {
    current: () => current,
    close: () => current.close(),
    reopen: () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('injected reopen failure');
      }
      current = openDatabase({ filename: databasePath });
      current.migrate(schema);
      return current;
    }
  };
  const service = new BackupService({
    databasePath,
    appId: 'asset-demo',
    appVersion: '1.0.0',
    schemaVersion: schema.version,
    controller,
    permissions: new PermissionService(blueprint),
    audit: new AuditService('1.0.0', () => new Date('2026-09-16T08:00:00.000Z')),
    now: () => new Date('2026-09-16T08:00:00.000Z')
  });
  t.after(() => {
    try { current.close(); } catch { }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, databasePath, backupDirectory, controller, service };
}

function insertMetadata(database: RuntimeDatabase, value: string): void {
  database.prepare(
    'INSERT OR REPLACE INTO sys_metadata (key, value, updated_at) VALUES (?, ?, ?)'
  ).run('sample', value, new Date().toISOString());
}

function readMetadata(database: RuntimeDatabase): string {
  const row = database.prepare('SELECT value FROM sys_metadata WHERE key = ?').get('sample') as {
    value: string;
  };
  return row.value;
}

test('creates an independent manifested snapshot and refuses overwrite or unauthorized access', async (t) => {
  const { backupDirectory, controller, service } = setup(t);
  insertMetadata(controller.current(), 'before');

  const manifest = await service.createBackup(backupDirectory, maintainer);
  insertMetadata(controller.current(), 'after');

  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.appId, 'asset-demo');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(fs.existsSync(manifest.databasePath), true);
  assert.equal(fs.existsSync(manifest.manifestPath), true);
  const snapshot = new DatabaseSync(manifest.databasePath, { readOnly: true });
  try {
    const row = snapshot.prepare('SELECT value FROM sys_metadata WHERE key = ?').get('sample') as {
      value: string;
    };
    assert.equal(row.value, 'before');
  } finally {
    snapshot.close();
  }
  await assert.rejects(() => service.createBackup(backupDirectory, maintainer), code('BACKUP_FAILED'));
  await assert.rejects(() => service.createBackup(path.join(backupDirectory, 'other'), viewer), code('PERMISSION_DENIED'));
});

test('inspects and restores a valid backup after explicit confirmation', async (t) => {
  const { backupDirectory, controller, service } = setup(t);
  insertMetadata(controller.current(), 'before');
  const manifest = await service.createBackup(backupDirectory, maintainer);
  insertMetadata(controller.current(), 'after');

  const inspection = service.inspectBackup(manifest.databasePath, manifest.manifestPath);
  assert.equal(inspection.valid, true);
  assert.throws(() => service.restoreBackup(inspection, 'wrong-confirmation', maintainer), code('RESTORE_FAILED'));

  const result = service.restoreBackup(inspection, 'asset-demo', maintainer);
  assert.equal(result.restored, true);
  assert.equal(readMetadata(controller.current()), 'before');
  assert.equal(fs.existsSync(result.protectionPath), true);
});

test('rejects wrong app, future schema and digest mismatch', async (t) => {
  const { backupDirectory, service } = setup(t);
  const manifest = await service.createBackup(backupDirectory, maintainer);
  const original = JSON.parse(fs.readFileSync(manifest.manifestPath, 'utf8')) as Record<string, unknown>;

  fs.writeFileSync(manifest.manifestPath, JSON.stringify({ ...original, appId: 'other-app' }), 'utf8');
  assert.throws(() => service.inspectBackup(manifest.databasePath, manifest.manifestPath), code('RESTORE_FAILED'));

  fs.writeFileSync(manifest.manifestPath, JSON.stringify({ ...original, schemaVersion: 99 }), 'utf8');
  assert.throws(() => service.inspectBackup(manifest.databasePath, manifest.manifestPath), code('RESTORE_FAILED'));

  fs.writeFileSync(manifest.manifestPath, JSON.stringify(original), 'utf8');
  fs.appendFileSync(manifest.databasePath, 'tampered');
  assert.throws(() => service.inspectBackup(manifest.databasePath, manifest.manifestPath), code('RESTORE_FAILED'));
});

test('restores the original database if replacement cannot reopen', async (t) => {
  const { backupDirectory, controller, service } = setup(t, 1);
  insertMetadata(controller.current(), 'original');
  const manifest = await service.createBackup(backupDirectory, maintainer);
  insertMetadata(controller.current(), 'current');
  const inspection = service.inspectBackup(manifest.databasePath, manifest.manifestPath);

  assert.throws(() => service.restoreBackup(inspection, 'asset-demo', maintainer), code('RESTORE_FAILED'));
  assert.equal(readMetadata(controller.current()), 'current');
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
