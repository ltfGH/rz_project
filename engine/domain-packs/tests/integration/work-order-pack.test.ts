import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

test('loads and composes the production work order service pack', () => {
  const packRoot = path.resolve(__dirname, '..', '..', 'packs', 'work_order_service');
  const pack = loadPack(packRoot);
  const registry = new PackRegistry();
  registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0',
    runtimeVersion: '1.0.0',
    software: {
      id: 'work_order_app', name: '离线工单服务管理软件', version: '1.0.0',
      purpose: '管理服务工单处理与复核闭环',
      targetUsers: ['调度人员', '处理人员', '复核人员'],
      boundaries: ['离线运行', '不包含外部通知'], loginMode: 'required'
    },
    selections: [{ id: 'work_order_service', version: '1.0.0', config: {} }],
    coverage: {
      supported: ['服务目录', 'SLA策略', '工单流转', '处理记录', '复核关闭'],
      unsupported: []
    },
    materials: {
      developmentPurpose: '形成可追溯的离线工单闭环', industry: '企业服务管理',
      technicalFeatures: ['SQLite事务', '角色分离', 'SLA固化与审计']
    }
  }, registry);

  assert.equal(result.valid, true, result.summary);
  assert.equal(result.canGenerate, true, result.summary);
  assert.deepEqual(result.issues, []);
  const blueprint = result.blueprint as any;
  assert.deepEqual(
    blueprint.entities.map((entity: any) => entity.id),
    ['service_catalog', 'sla_policy', 'work_order', 'work_order_event']
  );
  assert.equal(blueprint.modules.length, 4);
  assert.equal(blueprint.roles.length, 4);
  assert.equal(blueprint.workflows.length, 1);
  assert.equal(blueprint.dashboards.length, 5);

  const workflow = blueprint.workflows[0];
  assert.equal(workflow.id, 'work_order_lifecycle');
  assert.deepEqual(workflow.states, [
    'pending_dispatch', 'pending_acceptance', 'processing', 'pending_review', 'closed'
  ]);
  assert.equal(workflow.transitions.length, 6);
  assert.deepEqual(new Set(workflow.transitions.map((item: any) => item.permission)), new Set([
    'work_orders.dispatch', 'work_orders.accept',
    'work_orders.submit_resolution', 'work_orders.review'
  ]));

  const workOrder = blueprint.entities.find((entity: any) => entity.id === 'work_order');
  const event = blueprint.entities.find((entity: any) => entity.id === 'work_order_event');
  assert.equal(workOrder.retention, 'protected');
  assert.equal(workOrder.systemManaged, true);
  assert.equal(event.retention, 'append_only');
  assert.equal(event.history, true);
  assert.equal(event.systemManaged, true);
  assert.equal(
    event.fields.find((field: any) => field.id === 'event_type').options.length,
    7
  );

  const workOrderModule = blueprint.modules.find((module: any) => module.id === 'work_orders');
  assert.equal(workOrderModule.actions.includes('create'), false);
  assert.equal(workOrderModule.actions.includes('update'), false);
  assert.deepEqual(pack.catalog.provides, ['work_order.core']);
  assert.deepEqual(pack.catalog.requires, []);
  assert.deepEqual(pack.catalog.uiSlots, [
    'entity.detail.tabs', 'entity.detail.actions', 'dashboard.sections'
  ]);
  assert.deepEqual(
    pack.fragment.publicExtensionPoints.map((point) => point.id),
    [
      'work_order.fields',
      'work_order.relations',
      'work_order.detail.tabs',
      'work_order.lifecycle.transitions',
      'work_order.create.sources'
    ]
  );
});
