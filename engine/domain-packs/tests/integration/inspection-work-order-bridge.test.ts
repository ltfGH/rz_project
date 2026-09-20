import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compileSchema } from '../../../desktop-runtime/src/core/schema-compiler';
import { openDatabase } from '../../../desktop-runtime/src/core/database';
import {
  createInspectionWorkOrderCommand,
  createOpenRectificationBlocker,
  inspectionWorkOrderAbnormalHandler
} from '../../packs/inspection_work_order_bridge/runtime/inspection-work-order';
import type { InspectionReadConnection } from '../../packs/inspection_rectification/runtime/types';
import type { WorkOrderContext } from '../../packs/work_order_service/runtime/types';
import { AllowlistedDomainCommandBus } from '../../src/runtime/command-bus';
import type { DomainCommandExecutionContext } from '../../src/runtime/types';
import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

const actor = Object.freeze({ userId: 7, username: 'executor', displayName: '巡检执行人', roleId: 'inspection_executor' });

function composeBridge() {
  const registry = new PackRegistry();
  for (const id of ['inspection_rectification', 'work_order_service', 'inspection_work_order_bridge']) {
    registry.register(loadPack(path.resolve(__dirname, '..', '..', 'packs', id)));
  }
  return composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: { id: 'inspection_work_test', name: '巡检整改测试', version: '1.0.0', purpose: '验证异常整改', targetUsers: ['运维人员'], boundaries: ['离线'], loginMode: 'required' },
    selections: [
      { id: 'inspection_rectification', version: '1.0.0', config: {} },
      { id: 'work_order_service', version: '1.0.0', config: {} },
      { id: 'inspection_work_order_bridge', version: '1.0.0', config: { service_code: 'SVC-RECTIFICATION', priority: 'normal' } }
    ],
    coverage: { supported: ['异常整改'], unsupported: [] },
    materials: { developmentPurpose: '验证异常整改', industry: '企业运维', technicalFeatures: ['SQLite事务'] }
  }, registry);
}

function setup(t: test.TestContext) {
  const composed = composeBridge();
  assert.equal(composed.canGenerate, true, composed.summary);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inspection-work-order-'));
  const schema = compileSchema(composed.blueprint as any);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  const now = '2026-09-20T08:00:00.000Z';
  database.prepare("INSERT INTO biz_service_catalog(code,name,description,active,version,created_at,updated_at) VALUES('SVC-RECTIFICATION','整改服务','异常整改',1,1,?,?)").run(now, now);
  database.prepare("INSERT INTO biz_sla_policy(code,name,service_code,priority,response_minutes,resolution_minutes,active,version,created_at,updated_at) VALUES('SLA-R','整改策略','SVC-RECTIFICATION','normal',60,480,1,1,?,?)").run(now, now);
  database.prepare("INSERT INTO biz_inspection_plan(code,name,cycle_days,instructions,active,version,created_at,updated_at) VALUES('PLAN-1','日检',1,'检查',1,1,?,?)").run(now, now);
  database.prepare("INSERT INTO biz_inspection_task(code,plan_code,title,status,executor_id,scheduled_at,started_at,submitted_at,archived_at,version,created_at,updated_at) VALUES('TASK-1','PLAN-1','日检任务','executing','executor',?, ?,NULL,NULL,1,?,?)").run(now, now, now, now);
  database.prepare("INSERT INTO biz_inspection_item(code,task_code,name,standard,result,finding,disposition,checked_at,version,created_at,updated_at) VALUES('ITEM-1','TASK-1','温度','正常','abnormal','超温','转工单',?,2,?,?)").run(now, now, now);
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { database };
}

function workContext(execution: DomainCommandExecutionContext): WorkOrderContext {
  let sequence = 0;
  return {
    connection: execution.connection, actor: execution.actor,
    requirePermission: () => undefined, appendAudit: () => undefined, identityHasRole: () => true,
    now: () => new Date('2026-09-20T08:00:00.000Z'),
    orderCode: () => `WO-R-${++sequence}`, eventCode: () => `WOE-R-${++sequence}`
  };
}

function bus(connection: any) {
  return new AllowlistedDomainCommandBus([
    createInspectionWorkOrderCommand(workContext)
  ], Object.freeze({ connection, actor, sourcePluginId: 'inspection_work_order_bridge' }));
}

const abnormality = Object.freeze({ taskId: 1, taskCode: 'TASK-1', itemId: 1, itemCode: 'ITEM-1', resultCode: 'abnormal' as const, recordedBy: 'executor' });

test('composes an immutable abnormality-to-work-order link and two detail tabs', () => {
  const result = composeBridge();
  assert.equal(result.canGenerate, true, result.summary);
  const entities = result.blueprint!.entities as any[];
  const link = entities.find((entity) => entity.id === 'inspection_work_order_link');
  assert.equal(link.retention, 'append_only');
  assert.equal(link.fields.find((field: any) => field.id === 'inspection_item_code').unique, true);
  assert.equal(entities.find((entity) => entity.id === 'inspection_task').detailTabs.some((tab: any) => tab.id === 'rectification_work_orders'), true);
  assert.equal(entities.find((entity) => entity.id === 'work_order').detailTabs.some((tab: any) => tab.id === 'inspection_source'), true);
});

test('creates one linked work order for repeated delivery of the same abnormality', (t) => {
  const runtime = setup(t);
  runtime.database.transaction((connection) => inspectionWorkOrderAbnormalHandler(abnormality, bus(connection)));
  runtime.database.transaction((connection) => inspectionWorkOrderAbnormalHandler(abnormality, bus(connection)));
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_work_order').get() as { count: number }).count, 1);
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_inspection_work_order_link').get() as { count: number }).count, 1);
});

test('rolls back the work order and link when the caller transaction fails', (t) => {
  const runtime = setup(t);
  assert.throws(() => runtime.database.transaction((connection) => {
    inspectionWorkOrderAbnormalHandler(abnormality, bus(connection));
    throw new Error('later inspection handler failed');
  }), /later inspection handler failed/);
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_work_order').get() as { count: number }).count, 0);
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_inspection_work_order_link').get() as { count: number }).count, 0);
});

test('blocks archive until every abnormal item has a closed linked work order', (t) => {
  const runtime = setup(t);
  const blocker = createOpenRectificationBlocker();
  const read = (connection: any): InspectionReadConnection => ({
    find: (entityId, filters) => {
      const table = `biz_${entityId}`;
      const entries = Object.entries(filters);
      const where = entries.map(([field]) => `${field}=?`).join(' AND ');
      return connection.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...entries.map(([, value]) => value)) as any[];
    }
  });
  runtime.database.transaction((connection) => {
    assert.equal(blocker(1, read(connection)).blocked, true);
    inspectionWorkOrderAbnormalHandler(abnormality, bus(connection));
    assert.equal(blocker(1, read(connection)).blocked, true);
    connection.prepare("UPDATE biz_work_order SET status='closed'").run();
    assert.equal(blocker(1, read(connection)).blocked, false);
  });
});
