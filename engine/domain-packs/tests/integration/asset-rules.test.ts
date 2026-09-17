import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import {
  AssetLifecycleService,
  type AssetLifecycleContext
} from '../../packs/asset_registry/runtime/index';
import { openDatabase } from '../../../desktop-runtime/src/core/database';
import { compileSchema } from '../../../desktop-runtime/src/core/schema-compiler';
import { EntityRepository } from '../../../desktop-runtime/src/core/entity-repository';
import type { ActorDto } from '../../../desktop-runtime/src/shared/dto';
import { AppError } from '../../../desktop-runtime/src/shared/errors';

const actor: ActorDto = {
  userId: 1, username: 'asset_admin', displayName: '资产管理员', roleId: 'asset_admin'
};

let eventSequence = 0;

function composedBlueprint(): any {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'asset_registry'));
  const registry = new PackRegistry();
  registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: {
      id: 'asset_rules', name: '资产规则测试软件', version: '1.0.0', purpose: '测试资产规则',
      targetUsers: ['管理员'], boundaries: ['离线'], loginMode: 'required'
    },
    selections: [{ id: 'asset_registry', version: '1.0.0', config: {} }],
    coverage: { supported: ['资产台账'], unsupported: [] },
    materials: { developmentPurpose: '测试资产规则', industry: '企业管理', technicalFeatures: ['离线'] }
  }, registry);
  assert.equal(result.canGenerate, true, result.summary);
  return result.blueprint;
}

function setup(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-rules-'));
  const blueprint = composedBlueprint();
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  const repository = new EntityRepository(database, blueprint, schema);
  repository.create('asset_category', { code: 'CAT-1', name: '设备', active: true }, actor);
  const asset = repository.create('asset', {
    code: 'AST-1', name: '资产', category_code: 'CAT-1', status: 'active', location: ''
  }, actor);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, repository, asset };
}

function context(connection: any, overrides: Partial<AssetLifecycleContext> = {}): AssetLifecycleContext {
  return {
    connection,
    actor,
    requirePermission: () => undefined,
    appendAudit: () => undefined,
    blockers: [],
    assigneeExists: () => true,
    now: () => new Date('2026-09-17T08:00:00.000Z'),
    eventCode: () => `AEVT-RULE-${++eventSequence}`,
    ...overrides
  };
}

test('allows deletion only when the asset has no responsibility or event history', (t) => {
  const { database, repository, asset } = setup(t);
  const service = new AssetLifecycleService();
  database.transaction((connection) => service.assertCanDelete(asset.id, context(connection)));

  database.prepare(
    `INSERT INTO biz_asset_responsibility
      (code, asset_code, assignee, started_at, ended_at, active, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 1, 1, ?, ?)`
  ).run(
    'RESP-1', 'AST-1', '张工', '2026-09-17T08:00:00.000Z',
    '2026-09-17T08:00:00.000Z', '2026-09-17T08:00:00.000Z'
  );
  assert.throws(
    () => database.transaction((connection) => service.assertCanDelete(asset.id, context(connection))),
    code('INVALID_TRANSITION')
  );

  database.prepare('DELETE FROM biz_asset_responsibility WHERE asset_code = ?').run('AST-1');
  database.transaction((connection) => service.changeStatus({
    assetId: asset.id, expectedVersion: 1, nextStatus: 'maintenance', reason: '维护'
  }, context(connection)));
  assert.throws(
    () => database.transaction((connection) => service.assertCanDelete(asset.id, context(connection))),
    code('INVALID_TRANSITION')
  );
});

test('assigns responsibility and writes asset event, version and audit atomically', (t) => {
  const { database, repository, asset } = setup(t);
  const service = new AssetLifecycleService();
  const permissions: string[] = [];
  const audits: string[] = [];
  const result = database.transaction((connection) => service.assignResponsibility({
    assetId: asset.id,
    expectedVersion: 1,
    responsibilityCode: 'RESP-1',
    assignee: '张工',
    reason: '首次分配'
  }, context(connection, {
    requirePermission: (_actor, permission) => permissions.push(permission),
    appendAudit: (_connection, entry) => audits.push(entry.permission)
  })));

  assert.equal(result.assetVersion, 2);
  assert.equal(result.assignee, '张工');
  assert.deepEqual(permissions, ['asset_responsibilities.assign']);
  assert.deepEqual(audits, ['asset_responsibilities.assign']);
  assert.equal(repository.get('asset', asset.id, actor).version, 2);
  const responsibility = database.prepare(
    'SELECT code, assignee, active FROM biz_asset_responsibility WHERE asset_code = ?'
  ).get('AST-1') as { code: string; assignee: string; active: number };
  assert.deepEqual({ ...responsibility }, { code: 'RESP-1', assignee: '张工', active: 1 });
  const events = database.prepare(
    "SELECT COUNT(*) AS count FROM biz_asset_event WHERE event_type = 'responsibility_changed'"
  ).get() as { count: number };
  assert.equal(events.count, 1);
});

test('rejects duplicate active responsibility and replaces a different assignee', (t) => {
  const { database, asset } = setup(t);
  const service = new AssetLifecycleService();
  const assign = (expectedVersion: number, codeValue: string, assignee: string) => (
    database.transaction((connection) => service.assignResponsibility({
      assetId: asset.id,
      expectedVersion,
      responsibilityCode: codeValue,
      assignee,
      reason: '责任调整'
    }, context(connection)))
  );
  assign(1, 'RESP-1', '张工');
  assert.throws(() => assign(2, 'RESP-2', '张工'), code('INVALID_TRANSITION'));

  const result = assign(2, 'RESP-2', '李工');
  assert.equal(result.assetVersion, 3);
  assert.equal(result.previousAssignee, '张工');
  const rows = database.prepare(
    'SELECT code, assignee, active, ended_at FROM biz_asset_responsibility ORDER BY id'
  ).all() as Array<{ code: string; assignee: string; active: number; ended_at: string | null }>;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.active, 0);
  assert.equal(rows[0]?.ended_at, '2026-09-17T08:00:00.000Z');
  assert.deepEqual(
    { ...rows[1] },
    { code: 'RESP-2', assignee: '李工', active: 1, ended_at: null }
  );
});

test('rolls back responsibility changes when the asset version is stale', (t) => {
  const { database, asset } = setup(t);
  const service = new AssetLifecycleService();
  assert.throws(() => database.transaction((connection) => service.assignResponsibility({
    assetId: asset.id,
    expectedVersion: 99,
    responsibilityCode: 'RESP-1',
    assignee: '张工',
    reason: '无效分配'
  }, context(connection))), code('VERSION_CONFLICT'));
  const responsibilities = database.prepare(
    'SELECT COUNT(*) AS count FROM biz_asset_responsibility'
  ).get() as { count: number };
  const events = database.prepare('SELECT COUNT(*) AS count FROM biz_asset_event').get() as { count: number };
  assert.equal(responsibilities.count, 0);
  assert.equal(events.count, 0);
});

test('generic entity writes cannot bypass asset status or responsibility rules', (t) => {
  const { database, repository, asset } = setup(t);
  assert.throws(
    () => repository.update('asset', asset.id, asset.version, { status: 'inactive' }, actor),
    code('PERMISSION_DENIED')
  );
  assert.throws(() => repository.create('asset_responsibility', {
    code: 'RESP-BYPASS', asset_code: 'AST-1', assignee: '任意责任人',
    started_at: '2026-09-17T08:00:00.000Z', ended_at: null, active: true
  }, actor), code('PERMISSION_DENIED'));
  assert.equal(repository.get('asset', asset.id, actor).values.status, 'active');
  const responsibilities = database.prepare(
    'SELECT COUNT(*) AS count FROM biz_asset_responsibility'
  ).get() as { count: number };
  assert.equal(responsibilities.count, 0);
});

test('rejects an assignee not present in the caller-owned identity registry', (t) => {
  const { database, repository, asset } = setup(t);
  const service = new AssetLifecycleService();
  assert.throws(() => database.transaction((connection) => service.assignResponsibility({
    assetId: asset.id,
    expectedVersion: asset.version,
    responsibilityCode: 'RESP-UNKNOWN',
    assignee: 'UNKNOWN',
    reason: '无效责任分配'
  }, context(connection, { assigneeExists: () => false }))), code('VALIDATION_FAILED'));
  assert.equal(repository.get('asset', asset.id, actor).version, 1);
  const history = database.prepare(
    `SELECT
      (SELECT COUNT(*) FROM biz_asset_responsibility) AS responsibility_count,
      (SELECT COUNT(*) FROM biz_asset_event) AS event_count`
  ).get() as { responsibility_count: number; event_count: number };
  assert.deepEqual({ ...history }, { responsibility_count: 0, event_count: 0 });
});

test('rolls back a responsibility replacement when the late audit append fails', (t) => {
  const { database, repository, asset } = setup(t);
  const service = new AssetLifecycleService();
  const first = database.transaction((connection) => service.assignResponsibility({
    assetId: asset.id,
    expectedVersion: 1,
    responsibilityCode: 'RESP-1',
    assignee: '岗位-A',
    reason: '首次分配'
  }, context(connection)));

  assert.throws(() => database.transaction((connection) => service.assignResponsibility({
    assetId: asset.id,
    expectedVersion: first.assetVersion,
    responsibilityCode: 'RESP-2',
    assignee: '岗位-B',
    reason: '责任换绑'
  }, context(connection, {
    appendAudit: () => { throw new Error('audit failed after responsibility replacement'); }
  }))), /audit failed after responsibility replacement/);

  assert.equal(repository.get('asset', asset.id, actor).version, 2);
  const responsibilities = database.prepare(
    'SELECT code, assignee, active, ended_at FROM biz_asset_responsibility ORDER BY id'
  ).all() as Array<{ code: string; assignee: string; active: number; ended_at: string | null }>;
  assert.deepEqual(
    responsibilities.map((row) => ({ ...row })),
    [{ code: 'RESP-1', assignee: '岗位-A', active: 1, ended_at: null }]
  );
  const events = database.prepare('SELECT COUNT(*) AS count FROM biz_asset_event').get() as { count: number };
  assert.equal(events.count, 1);
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
