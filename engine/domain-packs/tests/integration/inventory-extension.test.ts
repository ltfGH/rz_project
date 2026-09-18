import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

test('allows a registered application pack to extend every inventory container', () => {
  const inventory = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'inventory_batch'));
  const bridge = loadPack(path.resolve(__dirname, '..', 'fixtures', 'packs', 'inventory-application-bridge'));
  const registry = new PackRegistry();
  registry.register(inventory);
  registry.register(bridge);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: { id: 'inventory_extended', name: '申领库存管理软件', version: '1.0.0', purpose: '验证库存扩展', targetUsers: ['库存岗位'], boundaries: ['离线'], loginMode: 'required' },
    selections: [{ id: 'inventory_batch', version: '1.0.0', config: { quantity_scale: 3 } }, { id: 'application_archive', version: '1.0.0', config: {} }],
    coverage: { supported: ['库存申领'], unsupported: [] },
    materials: { developmentPurpose: '验证扩展', industry: '企业管理', technicalFeatures: ['离线事务'] }
  }, registry);
  assert.equal(result.canGenerate, true, result.summary);
  const entities = (result.blueprint as any).entities;
  const material = entities.find((entity: any) => entity.id === 'material');
  const batch = entities.find((entity: any) => entity.id === 'inventory_batch');
  const transaction = entities.find((entity: any) => entity.id === 'inventory_transaction');
  assert.ok(material.fields.some((field: any) => field.id === 'application_code'));
  assert.ok(material.relations.some((relation: any) => relation.id === 'material_application'));
  assert.ok(batch.fields.some((field: any) => field.id === 'application_code'));
  assert.ok(batch.relations.some((relation: any) => relation.id === 'batch_application'));
  assert.deepEqual(batch.detailTabs, [{ id: 'application_context', name: '申领档案', viewId: 'application_context' }]);
  assert.deepEqual(batch.createSources, [{ id: 'application_source', name: '从申领单入库' }]);
  assert.ok(transaction.fields.some((field: any) => field.id === 'application_code'));
  assert.ok(transaction.relations.some((relation: any) => relation.id === 'transaction_application'));
});
