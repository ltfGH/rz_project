import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { InspectionService } from '../../packs/inspection_rectification/runtime/inspection-service';
import {
  admin,
  createInspectionTestRuntime,
  inspectionContext
} from '../helpers/inspection-runtime';

const request = Object.freeze({
  name: '机房巡检计划', cycleDays: 7, instructions: '逐项检查并记录', active: true
});

test('creates and updates a validated inspection plan with audit', (t) => {
  const { database } = createInspectionTestRuntime(t, { seedPlan: false });
  const service = new InspectionService();
  const audits: string[] = [];
  const created = database.transaction((connection) => service.createPlan(
    request,
    inspectionContext(connection, admin, {
      appendAudit: (_connection, entry) => audits.push(entry.permission)
    })
  ));
  assert.equal(created.version, 1);
  assert.equal(created.cycleDays, 7);
  const updated = database.transaction((connection) => service.updatePlan({
    planId: created.planId, expectedVersion: created.version,
    name: '机房巡检计划（修订）', cycleDays: 14,
    instructions: '按修订标准执行', active: true
  }, inspectionContext(connection, admin, {
    appendAudit: (_connection, entry) => audits.push(entry.permission)
  })));
  assert.equal(updated.version, 2);
  assert.equal(updated.cycleDays, 14);
  assert.deepEqual(audits, ['inspection_plans.create_plan', 'inspection_plans.update_plan']);
});

test('rejects invalid cycles, identity, permission and stale versions', (t) => {
  const { database } = createInspectionTestRuntime(t, { seedPlan: false });
  const service = new InspectionService();
  assert.throws(() => database.transaction((connection) => service.createPlan(
    { ...request, cycleDays: 0 }, inspectionContext(connection, admin)
  )), code('VALIDATION_FAILED'));
  assert.throws(() => database.transaction((connection) => service.createPlan(
    request,
    inspectionContext(connection, admin, { identityHasRole: () => false })
  )), code('PERMISSION_DENIED'));
  assert.throws(() => database.transaction((connection) => service.createPlan(
    request,
    inspectionContext(connection, admin, {
      requirePermission: () => { throw new AppError('PERMISSION_DENIED', 'denied'); }
    })
  )), code('PERMISSION_DENIED'));
  const created = database.transaction((connection) => service.createPlan(
    request, inspectionContext(connection, admin)
  ));
  assert.throws(() => database.transaction((connection) => service.updatePlan({
    planId: created.planId, expectedVersion: 99,
    name: '过期修改', cycleDays: 10, instructions: '过期', active: true
  }, inspectionContext(connection, admin))), code('VERSION_CONFLICT'));
});

test('blocks generic plan writes and rolls back when audit fails', (t) => {
  const { database, repository } = createInspectionTestRuntime(t, { seedPlan: false });
  const service = new InspectionService();
  assert.throws(() => repository.create('inspection_plan', {
    code: 'BYPASS', name: '绕过计划', cycle_days: -1, instructions: '无效', active: true
  }, admin), code('PERMISSION_DENIED'));
  assert.throws(() => database.transaction((connection) => service.createPlan(
    request,
    inspectionContext(connection, admin, {
      appendAudit: () => { throw new Error('plan audit failed'); }
    })
  )), /plan audit failed/);
  const count = database.prepare('SELECT COUNT(*) AS count FROM biz_inspection_plan').get() as { count: number };
  assert.equal(count.count, 0);
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
