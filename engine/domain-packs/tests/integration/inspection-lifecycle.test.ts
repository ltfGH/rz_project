import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { InspectionService } from '../../packs/inspection_rectification/runtime/inspection-service';
import { createInspectionTestRuntime, executor, inspectionContext, planner, reviewer } from '../helpers/inspection-runtime';

function executing(t: test.TestContext) {
  const runtime = createInspectionTestRuntime(t);
  const service = new InspectionService();
  const task = runtime.database.transaction((connection) => service.createTask({
    planCode: 'PLAN-1', title: '闭环任务', executorId: executor.username,
    scheduledAt: '2026-09-19T08:00:00.000Z',
    items: [{ name: '项目一', standard: '正常' }, { name: '项目二', standard: '正常' }]
  }, inspectionContext(connection, planner)));
  const started = runtime.database.transaction((connection) => service.startTask({
    taskId: task.taskId, expectedTaskVersion: task.version
  }, inspectionContext(connection, executor)));
  return { ...runtime, service, task, started };
}

test('requires all items complete before review and separates reviewer', (t) => {
  const runtime = executing(t);
  const first = runtime.database.transaction((connection) => runtime.service.recordItemResult({
    taskId: runtime.task.taskId, itemId: runtime.task.itemIds[0]!,
    expectedTaskVersion: runtime.started.version, expectedItemVersion: 1,
    result: 'normal', finding: null, disposition: null
  }, inspectionContext(connection, executor)));
  assert.throws(() => runtime.database.transaction((connection) => runtime.service.submitReview({
    taskId: runtime.task.taskId, expectedTaskVersion: first.taskVersion
  }, inspectionContext(connection, executor))), code('INVALID_TRANSITION'));
  const second = runtime.database.transaction((connection) => runtime.service.recordItemResult({
    taskId: runtime.task.taskId, itemId: runtime.task.itemIds[1]!,
    expectedTaskVersion: first.taskVersion, expectedItemVersion: 1,
    result: 'abnormal', finding: '发现异常', disposition: '现场处置'
  }, inspectionContext(connection, executor)));
  const submitted = runtime.database.transaction((connection) => runtime.service.submitReview({
    taskId: runtime.task.taskId, expectedTaskVersion: second.taskVersion
  }, inspectionContext(connection, executor)));
  assert.equal(submitted.status, 'pending_review');
  assert.ok(submitted.submittedAt);
  assert.throws(() => runtime.database.transaction((connection) => runtime.service.archiveTask({
    taskId: runtime.task.taskId, expectedTaskVersion: 999, comment: '   '
  }, inspectionContext(connection, executor, { identityHasRole: () => true }))), code('PERMISSION_DENIED'));
  const rejected = runtime.database.transaction((connection) => runtime.service.rejectReview({
    taskId: runtime.task.taskId, expectedTaskVersion: submitted.version, reason: '补充检查'
  }, inspectionContext(connection, reviewer)));
  assert.equal(rejected.status, 'executing');
  assert.equal(rejected.submittedAt, null);
});

test('runs blockers only for archive and rolls back a late audit failure', (t) => {
  const runtime = executing(t);
  let version = runtime.started.version;
  for (const itemId of runtime.task.itemIds) {
    const result = runtime.database.transaction((connection) => runtime.service.recordItemResult({
      taskId: runtime.task.taskId, itemId, expectedTaskVersion: version,
      expectedItemVersion: 1, result: 'normal', finding: null, disposition: null
    }, inspectionContext(connection, executor)));
    version = result.taskVersion;
  }
  const submitted = runtime.database.transaction((connection) => runtime.service.submitReview({
    taskId: runtime.task.taskId, expectedTaskVersion: version
  }, inspectionContext(connection, executor)));
  let blockerCalls = 0;
  const blocker = () => {
    blockerCalls += 1;
    return { blocked: true, code: 'OPEN_ORDER', message: '整改工单未关闭' };
  };
  assert.throws(() => runtime.database.transaction((connection) => runtime.service.archiveTask({
    taskId: runtime.task.taskId, expectedTaskVersion: submitted.version, comment: '归档'
  }, inspectionContext(connection, reviewer, { archiveBlockers: [blocker] }))), code('INVALID_TRANSITION'));
  assert.equal(blockerCalls, 1);
  const readonlyBlocker = (_taskId: number, read: any) => ({
    blocked: typeof read.exec === 'function' || typeof read.prepare('SELECT 1').run === 'function',
    code: 'MUTABLE', message: '阻断器不应获得写能力'
  });
  runtime.database.transaction((connection) => runtime.service.archiveTask({
    taskId: runtime.task.taskId, expectedTaskVersion: submitted.version, comment: '只读检查'
  }, inspectionContext(connection, reviewer, { archiveBlockers: [readonlyBlocker] })));
  runtime.database.prepare(
    "UPDATE biz_inspection_task SET status = 'pending_review', archived_at = NULL, version = ? WHERE id = ?"
  ).run(submitted.version, runtime.task.taskId);
  const beforeEvents = runtime.database.prepare(
    'SELECT COUNT(*) AS count FROM biz_inspection_event'
  ).get() as { count: number };
  assert.throws(() => runtime.database.transaction((connection) => runtime.service.archiveTask({
    taskId: runtime.task.taskId, expectedTaskVersion: submitted.version, comment: '归档'
  }, inspectionContext(connection, reviewer, {
    appendAudit: () => { throw new Error('archive audit failed'); }
  }))), /archive audit failed/);
  const row = runtime.database.prepare(
    'SELECT status, version, archived_at FROM biz_inspection_task WHERE id = ?'
  ).get(runtime.task.taskId) as Record<string, unknown>;
  assert.deepEqual({ ...row }, {
    status: 'pending_review', version: submitted.version, archived_at: null
  });
  const afterEvents = runtime.database.prepare(
    'SELECT COUNT(*) AS count FROM biz_inspection_event'
  ).get() as { count: number };
  assert.equal(afterEvents.count, beforeEvents.count);
  const archived = runtime.database.transaction((connection) => runtime.service.archiveTask({
    taskId: runtime.task.taskId, expectedTaskVersion: submitted.version, comment: '复核通过'
  }, inspectionContext(connection, reviewer)));
  assert.equal(archived.status, 'archived');
  assert.ok(archived.archivedAt);
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
