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

function composedBlueprint(): any {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'asset_registry'));
  const registry = new PackRegistry(); registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: {
      id: 'asset_test', name: '资产测试软件', version: '1.0.0', purpose: '测试资产',
      targetUsers: ['管理员'], boundaries: ['离线'], loginMode: 'required'
    },
    selections: [{ id: 'asset_registry', version: '1.0.0', config: {} }],
    coverage: { supported: ['资产台账'], unsupported: [] },
    materials: {
      developmentPurpose: '测试资产', industry: '企业管理', technicalFeatures: ['离线']
    }
  }, registry);
  assert.equal(result.canGenerate, true, result.summary);
  return result.blueprint;
}

function setup(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-lifecycle-'));
  const blueprint = composedBlueprint();
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  const repository = new EntityRepository(database, blueprint, schema);
  repository.create('asset_category', { code: 'CAT-1', name: '设备', active: true }, actor);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, repository };
}

let eventSequence = 0;

function context(connection: any, overrides: Partial<AssetLifecycleContext> = {}): AssetLifecycleContext {
  return {
    connection,
    actor,
    requirePermission: () => undefined,
    appendAudit: () => undefined,
    blockers: [],
    assigneeExists: () => true,
    now: () => new Date('2026-09-17T08:00:00.000Z'),
    eventCode: () => `AEVT-${++eventSequence}`,
    ...overrides
  };
}

test('executes every allowed lifecycle transition with event and audit', (t) => {
  const { database, repository } = setup(t);
  const service = new AssetLifecycleService();
  const allowed = [
    ['active', 'maintenance'], ['maintenance', 'active'], ['active', 'inactive'],
    ['maintenance', 'inactive'], ['inactive', 'active']
  ] as const;
  for (const [index, [from, to]] of allowed.entries()) {
    const asset = repository.create('asset', {
      code: `AST-${index}`, name: `资产 ${index}`, category_code: 'CAT-1', status: from, location: ''
    }, actor);
    const audits: string[] = [];
    const result = database.transaction((connection) => service.changeStatus({
      assetId: asset.id, expectedVersion: asset.version, nextStatus: to, reason: `${from} to ${to}`
    }, context(connection, { appendAudit: (_connection, entry) => audits.push(entry.permission) })));
    assert.equal(result.fromStatus, from);
    assert.equal(result.toStatus, to);
    assert.equal(result.version, 2);
    assert.deepEqual(audits, ['assets.change_status']);
  }
  const events = database.prepare('SELECT COUNT(*) AS count FROM biz_asset_event').get() as { count: number };
  assert.equal(events.count, 5);
});

test('rejects permission, invalid state, stale version and missing asset', (t) => {
  const { database, repository } = setup(t);
  const service = new AssetLifecycleService();
  const asset = repository.create('asset', {
    code: 'AST-1', name: '资产', category_code: 'CAT-1', status: 'active', location: ''
  }, actor);
  assert.throws(() => database.transaction((connection) => service.changeStatus({
    assetId: asset.id, expectedVersion: 1, nextStatus: 'maintenance', reason: '维护'
  }, context(connection, { requirePermission: () => { throw new AppError('PERMISSION_DENIED', 'denied'); } }))), code('PERMISSION_DENIED'));
  assert.throws(() => database.transaction((connection) => service.changeStatus({
    assetId: asset.id, expectedVersion: 1, nextStatus: 'active', reason: '无效'
  }, context(connection))), code('INVALID_TRANSITION'));
  assert.throws(() => database.transaction((connection) => service.changeStatus({
    assetId: asset.id, expectedVersion: 99, nextStatus: 'maintenance', reason: '过期'
  }, context(connection))), code('VERSION_CONFLICT'));
  assert.throws(() => database.transaction((connection) => service.changeStatus({
    assetId: 999, expectedVersion: 1, nextStatus: 'maintenance', reason: '不存在'
  }, context(connection))), code('NOT_FOUND'));
});

test('runs registered blockers only when transitioning to inactive', (t) => {
  const { database, repository } = setup(t);
  const service = new AssetLifecycleService();
  const asset = repository.create('asset', {
    code: 'AST-1', name: '资产', category_code: 'CAT-1', status: 'active', location: ''
  }, actor);
  let calls = 0;
  const blockers = [() => { calls += 1; return { blocked: true, code: 'OPEN_WORK', message: '存在未完成业务' }; }];
  assert.throws(() => database.transaction((connection) => service.changeStatus({
    assetId: asset.id, expectedVersion: 1, nextStatus: 'inactive', reason: '停用'
  }, context(connection, { blockers }))), code('INVALID_TRANSITION'));
  assert.equal(calls, 1);

  database.transaction((connection) => service.changeStatus({
    assetId: asset.id, expectedVersion: 1, nextStatus: 'maintenance', reason: '维护'
  }, context(connection, { blockers })));
  assert.equal(calls, 1);
});

test('rolls back status and event if audit append fails', (t) => {
  const { database, repository } = setup(t);
  const service = new AssetLifecycleService();
  const asset = repository.create('asset', {
    code: 'AST-1', name: '资产', category_code: 'CAT-1', status: 'active', location: ''
  }, actor);
  assert.throws(() => database.transaction((connection) => service.changeStatus({
    assetId: asset.id, expectedVersion: 1, nextStatus: 'maintenance', reason: '维护'
  }, context(connection, { appendAudit: () => { throw new Error('audit failed'); } }))), /audit failed/);
  assert.equal(repository.get('asset', asset.id, actor).values.status, 'active');
  const events = database.prepare('SELECT COUNT(*) AS count FROM biz_asset_event').get() as { count: number };
  assert.equal(events.count, 0);
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
