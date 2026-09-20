import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compileSchema } from '../../../desktop-runtime/src/core/schema-compiler';
import { EntityRepository } from '../../../desktop-runtime/src/core/entity-repository';
import { openDatabase } from '../../../desktop-runtime/src/core/database';
import { AssetLifecycleService, type AssetLifecycleContext } from '../../packs/asset_registry/runtime/index';
import {
  createAssetInspectionPlan,
  createAssetInspectionTask,
  createOpenInspectionAssetBlocker,
  readAssetInspectionHistory
} from '../../packs/asset_inspection_bridge/runtime/asset-inspection';
import type { InspectionContext } from '../../packs/inspection_rectification/runtime/types';
import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

const assetAdmin = Object.freeze({ userId: 1, username: 'asset-admin', displayName: '资产管理员', roleId: 'asset_admin' });
const planner = Object.freeze({ userId: 2, username: 'planner', displayName: '巡检计划员', roleId: 'inspection_planner' });

function composeBridge() {
  const registry = new PackRegistry();
  for (const id of ['asset_registry', 'inspection_rectification', 'asset_inspection_bridge']) {
    registry.register(loadPack(path.resolve(__dirname, '..', '..', 'packs', id)));
  }
  return composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: { id: 'asset_inspection_test', name: '资产巡检测试', version: '1.0.0', purpose: '验证资产巡检', targetUsers: ['巡检人员'], boundaries: ['离线'], loginMode: 'required' },
    selections: [
      { id: 'asset_registry', version: '1.0.0', config: {} },
      { id: 'inspection_rectification', version: '1.0.0', config: {} },
      { id: 'asset_inspection_bridge', version: '1.0.0', config: {} }
    ],
    coverage: { supported: ['资产巡检'], unsupported: [] },
    materials: { developmentPurpose: '验证资产巡检', industry: '企业运维', technicalFeatures: ['SQLite事务'] }
  }, registry);
}

function setup(t: test.TestContext) {
  const composed = composeBridge();
  assert.equal(composed.canGenerate, true, composed.summary);
  const blueprint = composed.blueprint as any;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-inspection-'));
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  const repository = new EntityRepository(database, blueprint, schema);
  repository.create('asset_category', { code: 'CAT-1', name: '设备', active: true }, assetAdmin);
  const asset = repository.create('asset', { code: 'AST-1', name: '泵站', category_code: 'CAT-1', status: 'active', location: 'A区' }, assetAdmin);
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { database, repository, asset };
}

function inspectionContext(connection: any): InspectionContext {
  let sequence = 0;
  return {
    connection, actor: planner, requirePermission: () => undefined, appendAudit: () => undefined,
    identityHasRole: () => true, archiveBlockers: [], abnormalHandlers: [], commandBus: { invoke: () => undefined },
    now: () => new Date('2026-09-20T08:00:00.000Z'),
    planCode: () => `PLAN-B-${++sequence}`, taskCode: () => `TASK-B-${++sequence}`,
    itemCode: () => `ITEM-B-${++sequence}`, eventCode: () => `EVENT-B-${++sequence}`
  };
}

function assetContext(connection: any, blockers: AssetLifecycleContext['blockers']): AssetLifecycleContext {
  return {
    connection, actor: assetAdmin, requirePermission: () => undefined, appendAudit: () => undefined,
    blockers, assigneeExists: () => true, now: () => new Date('2026-09-20T08:00:00.000Z'),
    eventCode: () => 'ASSET-EVENT-B-1'
  };
}

test('composes asset references for plans and tasks plus asset history', () => {
  const result = composeBridge();
  assert.equal(result.canGenerate, true, result.summary);
  const entities = result.blueprint!.entities as any[];
  for (const id of ['inspection_plan', 'inspection_task']) {
    const entity = entities.find((candidate) => candidate.id === id);
    assert.deepEqual(entity.fields.find((field: any) => field.id === 'asset_code').reference, { entity: 'asset', field: 'code' });
    assert.equal(entity.relations.some((relation: any) => relation.id === `${id}_asset`), true);
  }
  const asset = entities.find((candidate) => candidate.id === 'asset');
  assert.equal(asset.detailTabs.some((tab: any) => tab.id === 'inspection_history'), true);
});

test('creates a plan and task for the same active asset and rejects an inactive asset', (t) => {
  const runtime = setup(t);
  const plan = runtime.database.transaction((connection) => createAssetInspectionPlan({
    assetId: runtime.asset.id, name: '泵站日检', cycleDays: 1, instructions: '逐项检查', active: true
  }, inspectionContext(connection)));
  const task = runtime.database.transaction((connection) => createAssetInspectionTask({
    planCode: plan.planCode, title: '泵站日检任务', executorId: 'executor',
    scheduledAt: '2026-09-21T08:00:00.000Z', items: [{ name: '压力', standard: '压力正常' }]
  }, inspectionContext(connection)));
  const relation = runtime.database.prepare('SELECT asset_code FROM biz_inspection_task WHERE id=?').get(task.taskId) as { asset_code: string };
  assert.equal(relation.asset_code, 'AST-1');

  runtime.database.prepare("UPDATE biz_asset SET status='inactive' WHERE id=?").run(runtime.asset.id);
  assert.throws(() => runtime.database.transaction((connection) => createAssetInspectionTask({
    planCode: plan.planCode, title: '无效任务', executorId: 'executor',
    scheduledAt: '2026-09-22T08:00:00.000Z', items: [{ name: '压力', standard: '压力正常' }]
  }, inspectionContext(connection))), /active asset/i);
});

test('blocks deactivation for an unarchived task and preserves archived history', (t) => {
  const runtime = setup(t);
  const plan = runtime.database.transaction((connection) => createAssetInspectionPlan({
    assetId: runtime.asset.id, name: '泵站日检', cycleDays: 1, instructions: '逐项检查', active: true
  }, inspectionContext(connection)));
  const task = runtime.database.transaction((connection) => createAssetInspectionTask({
    planCode: plan.planCode, title: '泵站日检任务', executorId: 'executor',
    scheduledAt: '2026-09-21T08:00:00.000Z', items: [{ name: '压力', standard: '压力正常' }]
  }, inspectionContext(connection)));
  const blocker = createOpenInspectionAssetBlocker();
  const assets = new AssetLifecycleService();
  assert.throws(() => runtime.database.transaction((connection) => assets.changeStatus({
    assetId: runtime.asset.id, expectedVersion: 1, nextStatus: 'inactive', reason: '停用'
  }, assetContext(connection, [blocker]))), /unarchived inspections/i);

  runtime.database.prepare("UPDATE biz_inspection_task SET status='archived' WHERE id=?").run(task.taskId);
  const changed = runtime.database.transaction((connection) => assets.changeStatus({
    assetId: runtime.asset.id, expectedVersion: 1, nextStatus: 'inactive', reason: '巡检已归档'
  }, assetContext(connection, [blocker])));
  assert.equal(changed.toStatus, 'inactive');
  const history = runtime.database.transaction((connection) => (
    readAssetInspectionHistory(runtime.asset.id, connection)
  ));
  assert.equal(history.length, 1);
  assert.equal(history[0]!.status, 'archived');
});
