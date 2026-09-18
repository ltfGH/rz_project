import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

test('loads and composes the production application archive pack', () => {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'application_archive'));
  const registry = new PackRegistry();
  registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion:'1.0', runtimeVersion:'1.0.0',
    software:{ id:'application_app', name:'离线申请归档管理软件', version:'1.0.0',
      purpose:'管理申请审批和文件归档', targetUsers:['申请审批岗位'], boundaries:['离线'], loginMode:'required' },
    selections:[{ id:'application_archive', version:'1.0.0', config:{ approval_levels:2, reminder_days:30 } }],
    coverage:{ supported:['申请审批归档'], unsupported:[] },
    materials:{ developmentPurpose:'审批归档', industry:'企业管理', technicalFeatures:['SQLite事务','SHA-256'] }
  }, registry);
  assert.equal(result.canGenerate, true, result.summary);
  const blueprint = result.blueprint as any;
  assert.deepEqual(blueprint.entities.map((entity:any) => entity.id), [
    'application','approval_node','approval_record','file_version','certificate','expiry_reminder'
  ]);
  assert.deepEqual(blueprint.modules.map((module:any) => module.id), [
    'applications','approval_nodes','approval_records','file_versions','certificates','expiry_reminders'
  ]);
  assert.deepEqual(blueprint.roles.map((role:any) => role.id), [
    'application_applicant','application_reviewer','application_compliance_reviewer',
    'application_archive_manager','application_admin'
  ]);
  assert.equal(blueprint.entities.every((entity:any) => entity.systemManaged === true), true);
  const records = blueprint.entities.find((entity:any) => entity.id === 'approval_record');
  assert.equal(records.retention, 'append_only');
  assert.equal(records.history, true);
  for (const module of blueprint.modules) {
    assert.equal(module.actions.includes('create'), false);
    assert.equal(module.actions.includes('update'), false);
    assert.equal(module.actions.includes('delete'), false);
  }
  assert.deepEqual(pack.catalog.provides, ['application.core','archive.core']);
  assert.deepEqual(pack.fragment.publicExtensionPoints.map((point) => point.id), [
    'application.fields','application.relations','application.detail.tabs','application.create.sources',
    'file_version.fields','file_version.relations','certificate.fields','certificate.relations','certificate.detail.tabs'
  ]);
});
