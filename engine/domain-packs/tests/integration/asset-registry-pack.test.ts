import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

test('loads and composes the production asset registry pack', () => {
  const packRoot = path.resolve(__dirname, '..', '..', 'packs', 'asset_registry');
  const pack = loadPack(packRoot);
  const registry = new PackRegistry();
  registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0',
    runtimeVersion: '1.0.0',
    software: {
      id: 'asset_app', name: '企业资产台账管理软件', version: '1.0.0',
      purpose: '管理企业资产及生命周期', targetUsers: ['资产管理员'],
      boundaries: ['离线运行'], loginMode: 'required'
    },
    selections: [{ id: 'asset_registry', version: '1.0.0', config: {} }],
    coverage: { supported: ['资产分类', '资产台账', '责任关系', '状态历史'], unsupported: [] },
    materials: {
      developmentPurpose: '形成可追溯的资产台账', industry: '企业资产管理',
      technicalFeatures: ['离线运行', '生命周期状态与审计']
    }
  }, registry);

  assert.equal(result.valid, true);
  assert.equal(result.canGenerate, true);
  assert.deepEqual(result.issues, []);
  const blueprint = result.blueprint as any;
  assert.equal(blueprint.entities.length, 4);
  assert.equal(blueprint.modules.length, 4);
  assert.equal(blueprint.roles.length, 2);
  assert.equal(blueprint.workflows.length, 1);
  assert.ok(blueprint.dashboards.length >= 3);
  const event = blueprint.entities.find((item: any) => item.id === 'asset_event');
  assert.equal(event.retention, 'append_only');
  assert.equal(event.history, true);
  assert.equal(event.systemManaged, true);
  const workflow = blueprint.workflows[0];
  assert.equal(workflow.id, 'asset_lifecycle');
  assert.equal(workflow.transitions.length, 5);
  assert.ok(pack.fragment.publicExtensionPoints.some((point) => point.id === 'asset.fields'));
  assert.ok(pack.fragment.publicExtensionPoints.some((point) => point.id === 'asset.lifecycle.transitions'));
});
