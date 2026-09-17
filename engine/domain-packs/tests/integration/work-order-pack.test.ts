import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import type { LoadedPack } from '../../src/shared/types';

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
  const slaPolicy = blueprint.entities.find((entity: any) => entity.id === 'sla_policy');
  const event = blueprint.entities.find((entity: any) => entity.id === 'work_order_event');
  assert.equal(workOrder.retention, 'protected');
  assert.equal(workOrder.systemManaged, true);
  assert.equal(slaPolicy.systemManaged, true);
  assert.equal(event.retention, 'append_only');
  assert.equal(event.history, true);
  assert.equal(event.systemManaged, true);
  assert.equal(
    event.fields.find((field: any) => field.id === 'event_type').options.length,
    7
  );

  const workOrderModule = blueprint.modules.find((module: any) => module.id === 'work_orders');
  const slaModule = blueprint.modules.find((module: any) => module.id === 'sla_policies');
  assert.equal(workOrderModule.actions.includes('create'), false);
  assert.equal(workOrderModule.actions.includes('update'), false);
  assert.equal(slaModule.actions.includes('create'), false);
  assert.equal(slaModule.actions.includes('update'), false);
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

test('allows a dependent pack to append declared work order extension containers', () => {
  const workOrderPack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'work_order_service'));
  const consumer: LoadedPack = {
    root: 'C:\\packs\\inspection_rectification',
    digest: 'a'.repeat(64),
    fragmentDigest: 'b'.repeat(64),
    entrypointDigests: {
      fragment: '1'.repeat(64), runtime: '2'.repeat(64), ui: '3'.repeat(64),
      seed: '4'.repeat(64), tests: '5'.repeat(64)
    },
    catalog: {
      catalogVersion: '1.0', id: 'inspection_rectification', version: '1.0.0',
      name: '告警工单桥接', description: '注册告警来源和工单详情页签',
      blueprintSchemaVersions: ['1.0'], runtimeVersions: ['1.0.0'],
      provides: ['inspection.core'], requires: ['work_order.core'],
      allowedDependencies: ['work_order_service'], migrationsVersion: 1,
      entrypoints: {
        fragment: 'blueprint.json', runtime: 'runtime/index.ts', ui: 'ui/index.ts',
        seed: 'seed/index.ts', tests: 'tests/index.ts'
      },
      uiSlots: ['entity.detail.tabs']
    },
    fragment: {
      fragmentVersion: '1.0',
      pack: { id: 'inspection_rectification', version: '1.0.0' },
      owns: { entities: [], modules: [], workflows: [], roles: [] },
      publicExtensionPoints: [],
      extensions: [
        {
          point: 'work_order.detail.tabs', operation: 'append', path: '/detailTabs',
          value: { id: 'alert_context', name: '告警上下文', viewId: 'alert_context' }
        },
        {
          point: 'work_order.create.sources', operation: 'append', path: '/createSources',
          value: { id: 'alert_source', name: '告警转工单' }
        }
      ],
      blueprint: { entities: [], modules: [], workflows: [], roles: [], dashboards: [] },
      seed: { records: {} }
    }
  };
  const registry = new PackRegistry();
  registry.register(workOrderPack);
  registry.register(consumer);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: {
      id: 'extended_work_order', name: '扩展工单软件', version: '1.0.0',
      purpose: '验证工单扩展', targetUsers: ['业务岗位'], boundaries: ['离线'], loginMode: 'required'
    },
    selections: [
      { id: 'work_order_service', version: '1.0.0', config: {} },
      { id: 'inspection_rectification', version: '1.0.0', config: {} }
    ],
    coverage: { supported: ['工单扩展'], unsupported: [] },
    materials: {
      developmentPurpose: '验证工单扩展', industry: '企业服务', technicalFeatures: ['离线']
    }
  }, registry);
  assert.equal(result.canGenerate, true, result.summary);
  const workOrder = (result.blueprint as any).entities.find((entity: any) => entity.id === 'work_order');
  assert.deepEqual(workOrder.detailTabs, [
    { id: 'alert_context', name: '告警上下文', viewId: 'alert_context' }
  ]);
  assert.deepEqual(workOrder.createSources, [
    { id: 'alert_source', name: '告警转工单' }
  ]);
});
