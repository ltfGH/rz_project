import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { InspectionService } from '../../packs/inspection_rectification/runtime/inspection-service';
import {
  createInspectionTestRuntime,
  executor,
  inspectionContext,
  planner
} from '../helpers/inspection-runtime';

function pendingTask(t: test.TestContext) {
  const runtime = createInspectionTestRuntime(t);
  const service = new InspectionService();
  const task = runtime.database.transaction((connection) => service.createTask({
    planCode: 'PLAN-1', title: '执行测试任务', executorId: 'executor-01',
    scheduledAt: '2026-09-19T08:00:00.000Z',
    items: [
      { name: '指示灯', standard: '状态正常' },
      { name: '环境温度', standard: '温度正常' }
    ]
  }, inspectionContext(connection, planner)));
  return { ...runtime, service, task };
}

test('assigns and starts only by a valid current executor', (t) => {
  const { database, service, task } = pendingTask(t);
  const assigned = database.transaction((connection) => service.assignExecutor({
    taskId: task.taskId, expectedTaskVersion: task.version,
    executorId: 'executor-02', reason: '调整执行岗位'
  }, inspectionContext(connection, planner, {
    identityHasRole: (identityId, roleId) => (
      (identityId === planner.username && roleId === planner.roleId) ||
      (identityId === 'executor-02' && roleId === 'inspection_executor')
    )
  })));
  assert.equal(assigned.version, 2);
  assert.equal(assigned.executorId, 'executor-02');
  const actor = { userId: 22, username: 'executor-02', displayName: '执行岗位-02', roleId: 'inspection_executor' };
  const started = database.transaction((connection) => service.startTask({
    taskId: task.taskId, expectedTaskVersion: assigned.version
  }, inspectionContext(connection, actor, {
    identityHasRole: (identityId, roleId) => identityId === 'executor-02' && roleId === 'inspection_executor'
  })));
  assert.equal(started.status, 'executing');
  assert.equal(started.version, 3);
  assert.equal(started.startedAt, '2026-09-18T08:00:00.000Z');
});

test('records normal and abnormal results with task and item versions', (t) => {
  const { database, service, task } = pendingTask(t);
  const started = database.transaction((connection) => service.startTask({
    taskId: task.taskId, expectedTaskVersion: 1
  }, inspectionContext(connection, executor)));
  const normal = database.transaction((connection) => service.recordItemResult({
    taskId: task.taskId, itemId: task.itemIds[0]!, expectedTaskVersion: started.version,
    expectedItemVersion: 1, result: 'normal', finding: null, disposition: null
  }, inspectionContext(connection, executor)));
  assert.equal(normal.taskVersion, 3);
  assert.equal(normal.itemVersion, 2);
  assert.equal(normal.result, 'normal');
  const abnormal = database.transaction((connection) => service.recordItemResult({
    taskId: task.taskId, itemId: task.itemIds[1]!, expectedTaskVersion: normal.taskVersion,
    expectedItemVersion: 1, result: 'abnormal',
    finding: '温度超过标准', disposition: '调整通风并复测'
  }, inspectionContext(connection, executor)));
  assert.equal(abnormal.taskVersion, 4);
  assert.equal(abnormal.itemVersion, 2);
  assert.equal(abnormal.result, 'abnormal');
  const events = database.prepare(
    "SELECT COUNT(*) AS count FROM biz_inspection_event WHERE event_type = 'item_recorded'"
  ).get() as { count: number };
  assert.equal(events.count, 2);
});

test('rejects invalid result details, ownership, identity and stale versions', (t) => {
  const { database, service, task } = pendingTask(t);
  const started = database.transaction((connection) => service.startTask({
    taskId: task.taskId, expectedTaskVersion: 1
  }, inspectionContext(connection, executor)));
  assert.throws(() => database.transaction((connection) => service.recordItemResult({
    taskId: task.taskId, itemId: task.itemIds[0]!, expectedTaskVersion: started.version,
    expectedItemVersion: 1, result: 'abnormal', finding: '异常', disposition: '   '
  }, inspectionContext(connection, executor))), code('VALIDATION_FAILED'));
  const other = { userId: 23, username: 'executor-02', displayName: '其他执行人', roleId: 'inspection_executor' };
  assert.throws(() => database.transaction((connection) => service.recordItemResult({
    taskId: task.taskId, itemId: task.itemIds[0]!, expectedTaskVersion: 999,
    expectedItemVersion: 999, result: 'normal', finding: null, disposition: null
  }, inspectionContext(connection, other, { identityHasRole: () => true }))), code('PERMISSION_DENIED'));
  assert.throws(() => database.transaction((connection) => service.recordItemResult({
    taskId: task.taskId, itemId: task.itemIds[0]!, expectedTaskVersion: 999,
    expectedItemVersion: 1, result: 'normal', finding: null, disposition: null
  }, inspectionContext(connection, executor))), code('VERSION_CONFLICT'));
  assert.throws(() => database.transaction((connection) => service.recordItemResult({
    taskId: task.taskId, itemId: 999, expectedTaskVersion: started.version,
    expectedItemVersion: 1, result: 'normal', finding: null, disposition: null
  }, inspectionContext(connection, executor))), code('NOT_FOUND'));
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
