import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compileSchema } from '../../../desktop-runtime/src/core/schema-compiler';
import { EntityRepository } from '../../../desktop-runtime/src/core/entity-repository';
import { openDatabase } from '../../../desktop-runtime/src/core/database';
import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import { AssetLifecycleService, type AssetLifecycleContext } from '../../packs/asset_registry/runtime/index';
import {
  createAssetLinkedWorkOrder,
  createOpenWorkOrderAssetBlocker
} from '../../packs/asset_work_order_bridge/runtime/asset-work-order';
import type { WorkOrderContext } from '../../packs/work_order_service/runtime/types';

const assetActor = Object.freeze({
  userId: 1,
  username: 'asset-admin',
  displayName: '资产管理员',
  roleId: 'asset_admin'
});
const dispatcher = Object.freeze({
  userId: 2,
  username: 'dispatcher',
  displayName: '调度员',
  roleId: 'work_order_dispatcher'
});
const workAdmin = Object.freeze({
  userId: 3,
  username: 'work-admin',
  displayName: '工单管理员',
  roleId: 'work_order_admin'
});

function composeBridge() {
  const registry = new PackRegistry();
  for (const id of ['asset_registry', 'work_order_service', 'asset_work_order_bridge']) {
    registry.register(loadPack(path.resolve(__dirname, '..', '..', 'packs', id)));
  }
  return composeDomainPacks({
    blueprintSchemaVersion: '1.0',
    runtimeVersion: '1.0.0',
    software: {
      id: 'asset_work_order_test',
      name: '资产工单测试',
      version: '1.0.0',
      purpose: '验证资产工单闭环',
      targetUsers: ['运维人员'],
      boundaries: ['离线'],
      loginMode: 'required'
    },
    selections: [
      { id: 'asset_registry', version: '1.0.0', config: {} },
      { id: 'work_order_service', version: '1.0.0', config: {} },
      { id: 'asset_work_order_bridge', version: '1.0.0', config: {} }
    ],
    coverage: { supported: ['资产关联工单'], unsupported: [] },
    materials: {
      developmentPurpose: '验证资产工单闭环',
      industry: '企业运维',
      technicalFeatures: ['SQLite事务']
    }
  }, registry);
}

function setup(t: test.TestContext) {
  const composed = composeBridge();
  assert.equal(composed.canGenerate, true, composed.summary);
  const blueprint = composed.blueprint as any;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-work-order-'));
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  const repository = new EntityRepository(database, blueprint, schema);
  repository.create('asset_category', { code: 'CAT-1', name: '设备', active: true }, assetActor);
  const asset = repository.create('asset', {
    code: 'AST-1', name: '空压机', category_code: 'CAT-1', status: 'active', location: 'A区'
  }, assetActor);
  repository.create('service_catalog', {
    code: 'SVC-1', name: '设备维修', description: '设备维修服务', active: true
  }, workAdmin);
  database.prepare(
    `INSERT INTO biz_sla_policy
      (code,name,service_code,priority,response_minutes,resolution_minutes,active,version,created_at,updated_at)
     VALUES ('SLA-1','普通维修','SVC-1','normal',60,480,1,1,?,?)`
  ).run('2026-09-20T08:00:00.000Z', '2026-09-20T08:00:00.000Z');
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { composed, blueprint, database, repository, asset };
}

function workContext(connection: any): WorkOrderContext {
  let sequence = 0;
  return {
    connection,
    actor: dispatcher,
    requirePermission: () => undefined,
    appendAudit: () => undefined,
    identityHasRole: () => true,
    now: () => new Date('2026-09-20T08:00:00.000Z'),
    orderCode: () => `WO-BRIDGE-${++sequence}`,
    eventCode: () => `WOE-BRIDGE-${++sequence}`
  };
}

function assetContext(connection: any, blockers: AssetLifecycleContext['blockers']): AssetLifecycleContext {
  return {
    connection,
    actor: assetActor,
    requirePermission: () => undefined,
    appendAudit: () => undefined,
    blockers,
    assigneeExists: () => true,
    now: () => new Date('2026-09-20T08:00:00.000Z'),
    eventCode: () => 'AE-BRIDGE-1'
  };
}

test('composes the asset reference, relation, tabs and create source', () => {
  const result = composeBridge();
  assert.equal(result.canGenerate, true, result.summary);
  const entities = result.blueprint!.entities as any[];
  const workOrder = entities.find((entity) => entity.id === 'work_order');
  const asset = entities.find((entity) => entity.id === 'asset');
  assert.deepEqual(workOrder.fields.find((field: any) => field.id === 'asset_code').reference, {
    entity: 'asset', field: 'code'
  });
  assert.equal(workOrder.relations.some((relation: any) => relation.id === 'work_order_asset'), true);
  assert.equal(workOrder.detailTabs.some((tab: any) => tab.id === 'asset_context'), true);
  assert.equal(workOrder.createSources.some((source: any) => source.id === 'asset_source'), true);
  assert.equal(asset.detailTabs.some((tab: any) => tab.id === 'work_order_history'), true);
});

test('creates the work order and asset relation in one transaction', (t) => {
  const runtime = setup(t);
  const result = runtime.database.transaction((connection) => createAssetLinkedWorkOrder({
    assetId: runtime.asset.id,
    title: '空压机异响',
    description: '巡查发现持续异响',
    serviceCode: 'SVC-1',
    priority: 'normal'
  }, workContext(connection)));
  const row = runtime.database.prepare('SELECT asset_code,status FROM biz_work_order WHERE id=?')
    .get(result.workOrderId) as { asset_code: string; status: string };
  assert.deepEqual({ ...row }, { asset_code: 'AST-1', status: 'pending_dispatch' });

  assert.throws(() => runtime.database.transaction((connection) => createAssetLinkedWorkOrder({
    assetId: 999,
    title: '无效资产',
    description: '不应创建工单',
    serviceCode: 'SVC-1',
    priority: 'normal'
  }, workContext(connection))), /asset/i);
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_work_order').get() as { count: number }).count, 1);
});

test('blocks asset deactivation until every related work order is closed', (t) => {
  const runtime = setup(t);
  runtime.database.transaction((connection) => createAssetLinkedWorkOrder({
    assetId: runtime.asset.id,
    title: '空压机异响',
    description: '巡查发现持续异响',
    serviceCode: 'SVC-1',
    priority: 'normal'
  }, workContext(connection)));
  const blocker = createOpenWorkOrderAssetBlocker();
  const assets = new AssetLifecycleService();
  assert.throws(() => runtime.database.transaction((connection) => assets.changeStatus({
    assetId: runtime.asset.id,
    expectedVersion: 1,
    nextStatus: 'inactive',
    reason: '停用'
  }, assetContext(connection, [blocker]))), /open work orders/i);

  runtime.database.prepare("UPDATE biz_work_order SET status='closed' WHERE asset_code='AST-1'").run();
  const changed = runtime.database.transaction((connection) => assets.changeStatus({
    assetId: runtime.asset.id,
    expectedVersion: 1,
    nextStatus: 'inactive',
    reason: '工单已关闭'
  }, assetContext(connection, [blocker])));
  assert.equal(changed.toStatus, 'inactive');
});
