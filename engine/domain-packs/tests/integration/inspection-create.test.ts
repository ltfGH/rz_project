import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { InspectionService } from '../../packs/inspection_rectification/runtime/inspection-service';
import {
  createInspectionTestRuntime,
  inspectionContext,
  planner
} from '../helpers/inspection-runtime';

const request = Object.freeze({
  planCode: 'PLAN-1', title: '每周机房巡检', executorId: 'executor-01',
  scheduledAt: '2026-09-19T08:00:00.000Z',
  items: [
    { name: '运行指示灯', standard: '指示灯状态正常' },
    { name: '环境温度', standard: '温度处于允许范围' }
  ]
});

test('creates a pending task, all items, event and audit atomically', (t) => {
  const { database } = createInspectionTestRuntime(t);
  const service = new InspectionService();
  const audits: string[] = [];
  const result = database.transaction((connection) => service.createTask(
    request,
    inspectionContext(connection, planner, {
      appendAudit: (_connection, entry) => audits.push(entry.permission)
    })
  ));
  assert.equal(result.status, 'pending');
  assert.equal(result.version, 1);
  assert.equal(result.executorId, 'executor-01');
  assert.equal(result.itemIds.length, 2);
  assert.deepEqual(audits, ['inspection_tasks.create_task']);
  const items = database.prepare(
    'SELECT name, result, version FROM biz_inspection_item WHERE task_code = ? ORDER BY id'
  ).all(result.taskCode) as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((row) => ({ ...row })), [
    { name: '运行指示灯', result: 'pending', version: 1 },
    { name: '环境温度', result: 'pending', version: 1 }
  ]);
  const event = database.prepare(
    'SELECT event_type, to_status FROM biz_inspection_event WHERE task_code = ?'
  ).get(result.taskCode) as Record<string, unknown>;
  assert.deepEqual({ ...event }, { event_type: 'created', to_status: 'pending' });
});

test('rejects invalid plan, executor, schedule and item definitions', (t) => {
  const service = new InspectionService();
  const inactive = createInspectionTestRuntime(t, { planActive: false });
  assert.throws(() => inactive.database.transaction((connection) => service.createTask(
    request, inspectionContext(connection)
  )), code('VALIDATION_FAILED'));
  const runtime = createInspectionTestRuntime(t);
  assert.throws(() => runtime.database.transaction((connection) => service.createTask(
    request, inspectionContext(connection, planner, {
      identityHasRole: (identityId, roleId) => (
        identityId === planner.username && roleId === planner.roleId
      )
    })
  )), code('VALIDATION_FAILED'));
  for (const invalid of [
    { ...request, title: '   ' },
    { ...request, scheduledAt: 'not-a-date' },
    { ...request, items: [] },
    { ...request, items: Array.from({ length: 101 }, (_, index) => ({ name: `检查项${index}`, standard: '标准' })) },
    { ...request, items: [{ name: '重复项', standard: '标准一' }, { name: ' 重复项 ', standard: '标准二' }] }
  ]) {
    assert.throws(() => runtime.database.transaction((connection) => service.createTask(
      invalid, inspectionContext(connection)
    )), code('VALIDATION_FAILED'));
  }
});

test('rolls back task and every item when audit append fails', (t) => {
  const { database } = createInspectionTestRuntime(t);
  const service = new InspectionService();
  assert.throws(() => database.transaction((connection) => service.createTask(
    request,
    inspectionContext(connection, planner, {
      appendAudit: () => { throw new Error('task audit failed'); }
    })
  )), /task audit failed/);
  const counts = database.prepare(
    `SELECT
      (SELECT COUNT(*) FROM biz_inspection_task) AS task_count,
      (SELECT COUNT(*) FROM biz_inspection_item) AS item_count,
      (SELECT COUNT(*) FROM biz_inspection_event) AS event_count`
  ).get() as Record<string, number>;
  assert.deepEqual({ ...counts }, { task_count: 0, item_count: 0, event_count: 0 });
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
