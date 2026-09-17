import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { WorkOrderService } from '../../packs/work_order_service/runtime/work-order-service';
import {
  admin,
  createWorkOrderTestRuntime,
  workOrderContext
} from '../helpers/work-order-runtime';

const policyRequest = Object.freeze({
  code: 'SLA-DOMAIN-1',
  name: '普通服务策略',
  serviceCode: 'SVC-1',
  priority: 'normal' as const,
  responseMinutes: 60,
  resolutionMinutes: 480,
  active: true
});

test('creates and updates a validated SLA policy with audit', (t) => {
  const { database } = createWorkOrderTestRuntime(t, { slaCount: 0 });
  const service = new WorkOrderService();
  const audits: string[] = [];
  const created = database.transaction((connection) => service.createSlaPolicy(
    policyRequest,
    workOrderContext(connection, admin, {
      appendAudit: (_connection, entry) => audits.push(entry.permission)
    })
  ));
  assert.equal(created.version, 1);
  assert.equal(created.responseMinutes, 60);
  const updated = database.transaction((connection) => service.updateSlaPolicy({
    policyId: created.policyId,
    expectedVersion: created.version,
    name: '普通服务策略（修订）',
    serviceCode: 'SVC-1',
    priority: 'normal',
    responseMinutes: 45,
    resolutionMinutes: 360,
    active: true
  }, workOrderContext(connection, admin, {
    appendAudit: (_connection, entry) => audits.push(entry.permission)
  })));
  assert.equal(updated.version, 2);
  assert.equal(updated.responseMinutes, 45);
  assert.deepEqual(audits, ['sla_policies.create_policy', 'sla_policies.update_policy']);
});

test('rejects invalid durations, duplicate active matches and stale updates', (t) => {
  const { database } = createWorkOrderTestRuntime(t, { slaCount: 0 });
  const service = new WorkOrderService();
  assert.throws(() => database.transaction((connection) => service.createSlaPolicy({
    ...policyRequest, responseMinutes: 0
  }, workOrderContext(connection, admin))), code('VALIDATION_FAILED'));
  const created = database.transaction((connection) => service.createSlaPolicy(
    policyRequest,
    workOrderContext(connection, admin)
  ));
  assert.throws(() => database.transaction((connection) => service.createSlaPolicy({
    ...policyRequest, code: 'SLA-DOMAIN-2'
  }, workOrderContext(connection, admin))), code('UNIQUE_CONFLICT'));
  assert.throws(() => database.transaction((connection) => service.updateSlaPolicy({
    policyId: created.policyId,
    expectedVersion: 99,
    name: '过期修改',
    serviceCode: 'SVC-1',
    priority: 'normal',
    responseMinutes: 30,
    resolutionMinutes: 300,
    active: true
  }, workOrderContext(connection, admin))), code('VERSION_CONFLICT'));
});

test('blocks generic SLA writes and rolls back domain creation when audit fails', (t) => {
  const { database, repository } = createWorkOrderTestRuntime(t, { slaCount: 0 });
  const service = new WorkOrderService();
  assert.throws(() => repository.create('sla_policy', {
    code: 'SLA-BYPASS', name: '绕过策略', service_code: 'SVC-1', priority: 'normal',
    response_minutes: -1, resolution_minutes: -1, active: true
  }, admin), code('PERMISSION_DENIED'));
  assert.throws(() => database.transaction((connection) => service.createSlaPolicy(
    policyRequest,
    workOrderContext(connection, admin, {
      appendAudit: () => { throw new Error('policy audit failed'); }
    })
  )), /policy audit failed/);
  const count = database.prepare('SELECT COUNT(*) AS count FROM biz_sla_policy').get() as { count: number };
  assert.equal(count.count, 0);
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
