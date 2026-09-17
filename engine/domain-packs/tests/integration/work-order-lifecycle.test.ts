import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { WorkOrderService } from '../../packs/work_order_service/runtime/work-order-service';
import {
  createWorkOrderTestRuntime,
  dispatcher,
  handler,
  reviewer,
  workOrderContext
} from '../helpers/work-order-runtime';

function processingOrder(t: test.TestContext) {
  const runtime = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  const created = runtime.database.transaction((connection) => service.create({
    title: '网络链路异常', description: '离线节点之间无法通信',
    serviceCode: 'SVC-1', priority: 'normal'
  }, workOrderContext(connection, dispatcher)));
  const dispatched = runtime.database.transaction((connection) => service.dispatch({
    workOrderId: created.workOrderId, expectedVersion: created.version,
    handlerId: 'handler-01', reason: '派发到处理岗位'
  }, workOrderContext(connection, dispatcher)));
  const accepted = runtime.database.transaction((connection) => service.accept({
    workOrderId: created.workOrderId, expectedVersion: dispatched.version
  }, workOrderContext(connection, handler)));
  return { ...runtime, service, created, accepted };
}

test('requires a processing record before submitting a resolution', (t) => {
  const { database, service, created, accepted } = processingOrder(t);
  assert.throws(() => database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId,
    expectedVersion: accepted.version,
    resolution: '已恢复链路'
  }, workOrderContext(connection, handler))), code('INVALID_TRANSITION'));

  const recorded = database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId,
    expectedVersion: accepted.version,
    content: '检查本地交换配置并重新加载'
  }, workOrderContext(connection, handler)));
  assert.equal(recorded.status, 'processing');
  assert.equal(recorded.version, 4);

  const submitted = database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId,
    expectedVersion: recorded.version,
    resolution: '重新加载配置后链路恢复'
  }, workOrderContext(connection, handler)));
  assert.equal(submitted.status, 'pending_review');
  assert.equal(submitted.version, 5);
  assert.equal(submitted.resolution, '重新加载配置后链路恢复');
  assert.equal(submitted.submittedAt, '2026-09-17T08:00:00.000Z');
});

test('enforces current handler and nonempty processing inputs', (t) => {
  const { database, service, created, accepted } = processingOrder(t);
  const otherHandler = {
    userId: 4, username: 'handler-02', displayName: '其他处理岗位', roleId: 'work_order_handler'
  };
  assert.throws(() => database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId,
    expectedVersion: accepted.version,
    content: '越权处理'
  }, workOrderContext(connection, otherHandler, { identityHasRole: () => true }))), code('PERMISSION_DENIED'));
  assert.throws(() => database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId,
    expectedVersion: accepted.version,
    content: '   '
  }, workOrderContext(connection, handler))), code('VALIDATION_FAILED'));
  assert.throws(() => database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId,
    expectedVersion: accepted.version,
    resolution: '   '
  }, workOrderContext(connection, handler))), code('VALIDATION_FAILED'));
});

test('rejects self-review and supports reject, rework and close', (t) => {
  const { database, service, created, accepted } = processingOrder(t);
  const firstRecord = database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: accepted.version,
    content: '完成第一轮处理'
  }, workOrderContext(connection, handler)));
  const firstSubmit = database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId, expectedVersion: firstRecord.version,
    resolution: '第一版解决方案'
  }, workOrderContext(connection, handler)));

  assert.throws(() => database.transaction((connection) => service.approveClose({
    workOrderId: created.workOrderId, expectedVersion: firstSubmit.version,
    comment: '本人复核'
  }, workOrderContext(connection, handler, {
    identityHasRole: () => true
  }))), code('PERMISSION_DENIED'));

  const rejected = database.transaction((connection) => service.rejectReview({
    workOrderId: created.workOrderId, expectedVersion: firstSubmit.version,
    reason: '需要补充验证记录'
  }, workOrderContext(connection, reviewer)));
  assert.equal(rejected.status, 'processing');
  assert.equal(rejected.resolution, null);
  assert.equal(rejected.submittedAt, null);

  const secondRecord = database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: rejected.version,
    content: '补充执行离线重启验证'
  }, workOrderContext(connection, handler)));
  const secondSubmit = database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId, expectedVersion: secondRecord.version,
    resolution: '验证通过，问题已解决'
  }, workOrderContext(connection, handler)));
  const closed = database.transaction((connection) => service.approveClose({
    workOrderId: created.workOrderId, expectedVersion: secondSubmit.version,
    comment: '复核通过'
  }, workOrderContext(connection, reviewer, {
    now: () => new Date('2026-09-17T10:00:00.000Z')
  })));
  assert.equal(closed.status, 'closed');
  assert.equal(closed.version, 9);
  assert.equal(closed.closedAt, '2026-09-17T10:00:00.000Z');
  assert.throws(() => database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: closed.version,
    content: '关闭后写入'
  }, workOrderContext(connection, handler))), code('INVALID_TRANSITION'));

  const events = database.prepare(
    'SELECT event_type FROM biz_work_order_event WHERE work_order_code = ? ORDER BY id'
  ).all(created.workOrderCode) as Array<{ event_type: string }>;
  assert.deepEqual(events.map((row) => row.event_type), [
    'created', 'dispatched', 'accepted', 'processing_recorded',
    'resolution_submitted', 'review_rejected', 'processing_recorded',
    'resolution_submitted', 'closed'
  ]);
});

test('rolls back close state, time and event when audit append fails', (t) => {
  const { database, service, created, accepted } = processingOrder(t);
  const recorded = database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: accepted.version, content: '完成处理'
  }, workOrderContext(connection, handler)));
  const submitted = database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId, expectedVersion: recorded.version, resolution: '处理完成'
  }, workOrderContext(connection, handler)));
  const beforeEvents = database.prepare(
    'SELECT COUNT(*) AS count FROM biz_work_order_event'
  ).get() as { count: number };

  assert.throws(() => database.transaction((connection) => service.approveClose({
    workOrderId: created.workOrderId, expectedVersion: submitted.version, comment: '复核通过'
  }, workOrderContext(connection, reviewer, {
    appendAudit: () => { throw new Error('audit failed after close'); }
  }))), /audit failed after close/);

  const row = database.prepare(
    'SELECT status, version, closed_at FROM biz_work_order WHERE id = ?'
  ).get(created.workOrderId) as Record<string, unknown>;
  assert.deepEqual({ ...row }, {
    status: 'pending_review', version: submitted.version, closed_at: null
  });
  const afterEvents = database.prepare(
    'SELECT COUNT(*) AS count FROM biz_work_order_event'
  ).get() as { count: number };
  assert.equal(afterEvents.count, beforeEvents.count);
});

test('checks handler and reviewer identity before exposing state or version', (t) => {
  const { database, service, created, accepted } = processingOrder(t);
  const otherHandler = {
    userId: 4, username: 'handler-02', displayName: '其他处理岗位', roleId: 'work_order_handler'
  };
  assert.throws(() => database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: 999, content: '越权处理'
  }, workOrderContext(connection, otherHandler, {
    identityHasRole: () => true
  }))), code('PERMISSION_DENIED'));

  const recorded = database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: accepted.version, content: '正常处理'
  }, workOrderContext(connection, handler)));
  const submitted = database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId, expectedVersion: recorded.version, resolution: '正常提交'
  }, workOrderContext(connection, handler)));
  assert.throws(() => database.transaction((connection) => service.approveClose({
    workOrderId: created.workOrderId, expectedVersion: submitted.version + 50, comment: '本人越权复核'
  }, workOrderContext(connection, handler, {
    identityHasRole: () => true
  }))), code('PERMISSION_DENIED'));
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
