import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

test('loads and composes the production project task pack', () => {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'project_task'));
  const registry = new PackRegistry();
  registry.register(pack);

  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0',
    runtimeVersion: '1.0.0',
    software: {
      id: 'project_app',
      name: '离线项目任务管理软件',
      version: '1.0.0',
      purpose: '管理项目交付闭环',
      targetUsers: ['项目岗位'],
      boundaries: ['离线运行'],
      loginMode: 'required'
    },
    selections: [{ id: 'project_task', version: '1.0.0', config: {} }],
    coverage: { supported: ['项目任务管理'], unsupported: [] },
    materials: {
      developmentPurpose: '项目交付管理',
      industry: '企业管理',
      technicalFeatures: ['SQLite 事务']
    }
  }, registry);

  assert.equal(result.canGenerate, true, result.summary);
  const blueprint = result.blueprint as any;
  assert.deepEqual(blueprint.entities.map((entity: any) => entity.id), [
    'project', 'milestone', 'project_task', 'project_risk', 'deliverable', 'project_event'
  ]);
  assert.deepEqual(blueprint.modules.map((module: any) => module.id), [
    'projects', 'milestones', 'project_tasks', 'project_risks', 'deliverables', 'project_events'
  ]);
  assert.deepEqual(blueprint.roles.map((role: any) => role.id), [
    'project_member', 'project_manager', 'project_reviewer', 'project_admin'
  ]);
  assert.equal(blueprint.entities.every((entity: any) => entity.systemManaged === true), true);
  const events = blueprint.entities.find((entity: any) => entity.id === 'project_event');
  assert.equal(events.retention, 'append_only');
  assert.equal(events.history, true);
  for (const module of blueprint.modules) {
    assert.equal(module.actions.includes('create'), false);
    assert.equal(module.actions.includes('update'), false);
    assert.equal(module.actions.includes('delete'), false);
  }
  assert.deepEqual(pack.fragment.publicExtensionPoints.map((point) => point.id), [
    'project.fields', 'project.relations', 'project.detail.tabs', 'project.create.sources',
    'project_task.fields', 'project_task.relations', 'project_task.detail.tabs',
    'project_task.create.sources', 'project_risk.fields', 'project_risk.relations',
    'deliverable.fields', 'deliverable.relations'
  ]);
  assert.deepEqual(pack.catalog.provides, ['project.core']);
});
