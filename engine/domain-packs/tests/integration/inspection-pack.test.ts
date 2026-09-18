import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

test('loads and composes the production inspection rectification pack', () => {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'inspection_rectification'));
  const registry = new PackRegistry();
  registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: {
      id: 'inspection_app', name: '离线巡检与整改管理软件', version: '1.0.0',
      purpose: '管理巡检执行、异常处置和复核归档',
      targetUsers: ['计划人员', '执行人员', '复核人员'],
      boundaries: ['离线运行', '不包含外部通知'], loginMode: 'required'
    },
    selections: [{ id: 'inspection_rectification', version: '1.0.0', config: {} }],
    coverage: {
      supported: ['巡检计划', '巡检任务', '检查项结果', '异常处置', '复核归档'],
      unsupported: []
    },
    materials: {
      developmentPurpose: '形成可追溯的离线巡检闭环', industry: '企业运维',
      technicalFeatures: ['SQLite事务', '双版本控制', '事件审计']
    }
  }, registry);

  assert.equal(result.valid, true, result.summary);
  assert.equal(result.canGenerate, true, result.summary);
  const blueprint = result.blueprint as any;
  assert.deepEqual(blueprint.entities.map((entity: any) => entity.id), [
    'inspection_plan', 'inspection_task', 'inspection_item', 'inspection_event'
  ]);
  assert.equal(blueprint.modules.length, 4);
  assert.equal(blueprint.roles.length, 4);
  assert.equal(blueprint.dashboards.length, 5);
  const workflow = blueprint.workflows[0];
  assert.equal(workflow.id, 'inspection_lifecycle');
  assert.deepEqual(workflow.states, ['pending', 'executing', 'pending_review', 'archived']);
  assert.equal(workflow.transitions.length, 5);

  for (const entityId of ['inspection_plan', 'inspection_task', 'inspection_item']) {
    assert.equal(
      blueprint.entities.find((entity: any) => entity.id === entityId).systemManaged,
      true
    );
  }
  const task = blueprint.entities.find((entity: any) => entity.id === 'inspection_task');
  assert.deepEqual(task.detailTabs, []);
  assert.deepEqual(task.createSources, []);
  const event = blueprint.entities.find((entity: any) => entity.id === 'inspection_event');
  assert.equal(event.retention, 'append_only');
  assert.equal(event.history, true);
  assert.equal(event.systemManaged, true);
  assert.equal(event.fields.find((field: any) => field.id === 'event_type').options.length, 7);

  for (const moduleId of ['inspection_plans', 'inspection_tasks', 'inspection_items', 'inspection_events']) {
    const module = blueprint.modules.find((item: any) => item.id === moduleId);
    assert.equal(module.actions.includes('create'), false);
    assert.equal(module.actions.includes('update'), false);
  }
  assert.deepEqual(pack.catalog.provides, ['inspection.core']);
  assert.deepEqual(pack.catalog.requires, []);
  assert.deepEqual(pack.catalog.uiSlots, [
    'entity.detail.tabs', 'entity.detail.actions', 'dashboard.sections'
  ]);
  assert.deepEqual(pack.fragment.publicExtensionPoints.map((point) => point.id), [
    'inspection_task.fields',
    'inspection_task.relations',
    'inspection_task.detail.tabs',
    'inspection_task.create.sources',
    'inspection_item.fields',
    'inspection_item.relations',
    'inspection.lifecycle.transitions'
  ]);
});
