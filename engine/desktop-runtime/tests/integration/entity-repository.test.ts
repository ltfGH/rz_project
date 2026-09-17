import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityRepository } from '../../src/core/entity-repository';
import { AppError } from '../../src/shared/errors';
import { adminActor, createTestRuntime } from '../helpers/runtime-fixture';

function repository(t: test.TestContext): EntityRepository {
  const runtime = createTestRuntime(t);
  return new EntityRepository(runtime.database, runtime.blueprint, runtime.schema);
}

function seed(repository: EntityRepository): void {
  repository.create('service', { code: 'SVC-A', name: '核心服务' }, adminActor);
  repository.create('service', { code: 'SVC-B', name: '辅助服务' }, adminActor);
  for (let index = 1; index <= 35; index += 1) {
    repository.create('asset', {
      code: `AST-${String(index).padStart(3, '0')}`,
      name: index === 7 ? '关键数据库节点' : `应用节点 ${index}`,
      service_id: index % 2 === 0 ? 'SVC-A' : 'SVC-B',
      status: index % 3 === 0 ? 'inactive' : 'active',
      quantity: index
    }, adminActor);
  }
}

test('lists stable pages with keyword, filters, sort and a shared total', (t) => {
  const target = repository(t);
  seed(target);

  const firstPage = target.list('asset', {
    page: 1,
    pageSize: 10,
    sort: { field: 'quantity', direction: 'desc' },
    filters: [{ field: 'status', operator: 'eq', value: 'active' }]
  }, adminActor);
  assert.equal(firstPage.items.length, 10);
  assert.equal(firstPage.total, 24);
  assert.equal(firstPage.items[0]!.values.quantity, 35);
  assert.equal(firstPage.items[1]!.values.quantity, 34);

  const keyword = target.list('asset', { page: 1, pageSize: 20, keyword: '数据库' }, adminActor);
  assert.equal(keyword.total, 1);
  assert.equal(keyword.items[0]!.values.code, 'AST-007');

  const range = target.list('asset', {
    page: 1,
    pageSize: 150,
    filters: [
      { field: 'quantity', operator: 'gte', value: 30 },
      { field: 'service_id', operator: 'in', value: ['SVC-A'] }
    ]
  }, adminActor);
  assert.equal(range.pageSize, 100);
  assert.equal(range.total, 3);
});

test('treats keyword and filter values as parameters', (t) => {
  const target = repository(t);
  seed(target);

  const result = target.list('asset', {
    page: 1,
    pageSize: 20,
    keyword: "%' OR 1=1 --"
  }, adminActor);
  assert.equal(result.total, 0);
  assert.equal(target.list('asset', { page: 1, pageSize: 20 }, adminActor).total, 35);
});

test('rejects unknown entities, fields, sorts and invalid filter values', (t) => {
  const target = repository(t);

  assert.throws(() => target.list('missing', { page: 1, pageSize: 20 }, adminActor), validationError);
  assert.throws(() => target.list('asset', {
    page: 1, pageSize: 20, sort: { field: 'missing', direction: 'asc' }
  }, adminActor), validationError);
  assert.throws(() => target.list('asset', {
    page: 1, pageSize: 20, filters: [{ field: 'missing', operator: 'eq', value: 1 }]
  }, adminActor), validationError);
  assert.throws(() => target.create('asset', { code: 'A', unexpected: true }, adminActor), validationError);
});

test('validates required, enum, type, unique and reference constraints', (t) => {
  const target = repository(t);
  target.create('service', { code: 'SVC-A', name: '核心服务' }, adminActor);

  assert.throws(() => target.create('asset', {
    code: 'A-1', service_id: 'SVC-A', status: 'unknown', quantity: 1
  }, adminActor), validationError);
  assert.throws(() => target.create('asset', {
    code: 'A-1', name: '资产', service_id: 'SVC-A', status: 'active', quantity: 'one'
  }, adminActor), validationError);
  assert.throws(() => target.create('asset', {
    code: 'A-1', name: '资产', service_id: 'MISSING', status: 'active', quantity: 1
  }, adminActor), validationError);

  target.create('asset', {
    code: 'A-1', name: '资产', service_id: 'SVC-A', status: 'active', quantity: 1
  }, adminActor);
  assert.throws(() => target.create('asset', {
    code: 'A-1', name: '重复', service_id: 'SVC-A', status: 'active', quantity: 2
  }, adminActor), (error: unknown) => error instanceof AppError && error.code === 'UNIQUE_CONFLICT');
});

test('updates with optimistic locking and never overwrites a newer version', (t) => {
  const target = repository(t);
  target.create('service', { code: 'SVC-A', name: '核心服务' }, adminActor);
  const created = target.create('asset', {
    code: 'A-1', name: '初始名称', service_id: 'SVC-A', status: 'active', quantity: 1
  }, adminActor);

  const updated = target.update('asset', created.id, created.version, { name: '新名称' }, adminActor);
  assert.equal(updated.version, 2);
  assert.equal(updated.values.name, '新名称');
  assert.throws(
    () => target.update('asset', created.id, created.version, { name: '旧页面覆盖' }, adminActor),
    (error: unknown) => error instanceof AppError && error.code === 'VERSION_CONFLICT'
  );
  assert.equal(target.get('asset', created.id, adminActor).values.name, '新名称');
});

test('rejects generic writes not declared by the entity module', (t) => {
  const runtime = createTestRuntime(t);
  const blueprint = structuredClone(runtime.blueprint);
  blueprint.modules = blueprint.modules?.map((module) => (
    module.entity === 'asset'
      ? { ...module, actions: module.actions.filter((action) => action !== 'update') }
      : module
  ));
  const target = new EntityRepository(runtime.database, blueprint, runtime.schema);
  target.create('service', { code: 'SVC-A', name: '核心服务' }, adminActor);
  const asset = target.create('asset', {
    code: 'A-1', name: '资产', service_id: 'SVC-A', status: 'active', quantity: 1
  }, adminActor);

  assert.throws(
    () => target.update('asset', asset.id, asset.version, { status: 'inactive' }, adminActor),
    permissionDenied
  );
  assert.equal(target.get('asset', asset.id, adminActor).values.status, 'active');
});

test('rejects generic writes when the actor role lacks the action permission', (t) => {
  const runtime = createTestRuntime(t);
  const blueprint = structuredClone(runtime.blueprint);
  blueprint.roles = blueprint.roles?.map((role) => ({
    ...role,
    permissions: role.permissions.filter((permission) => permission !== 'services.create')
  }));
  const target = new EntityRepository(runtime.database, blueprint, runtime.schema);

  assert.throws(
    () => target.create('service', { code: 'SVC-A', name: '核心服务' }, adminActor),
    permissionDenied
  );
});

test('authorizes a write when one of multiple entity modules owns the matching permission', (t) => {
  const runtime = createTestRuntime(t);
  const blueprint = structuredClone(runtime.blueprint);
  blueprint.modules = [
    ...(blueprint.modules ?? []),
    { id: 'asset_readonly', name: '资产只读视图', route: 'asset_readonly', entity: 'asset', actions: ['list', 'view'] }
  ];
  const target = new EntityRepository(runtime.database, blueprint, runtime.schema);
  target.create('service', { code: 'SVC-A', name: '核心服务' }, adminActor);

  const asset = target.create('asset', {
    code: 'A-1', name: '资产', service_id: 'SVC-A', status: 'active', quantity: 1
  }, adminActor);
  assert.equal(asset.values.code, 'A-1');
});

function validationError(error: unknown): boolean {
  return error instanceof AppError && error.code === 'VALIDATION_FAILED';
}

function permissionDenied(error: unknown): boolean {
  return error instanceof AppError && error.code === 'PERMISSION_DENIED';
}
