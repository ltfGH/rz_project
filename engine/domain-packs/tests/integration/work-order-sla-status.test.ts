import test from 'node:test';
import assert from 'node:assert/strict';

import { DashboardService } from '../../../desktop-runtime/src/core/dashboard-service';
import { WorkOrderService } from '../../packs/work_order_service/runtime/work-order-service';
import {
  createWorkOrderTestRuntime,
  dispatcher,
  handler,
  reviewer,
  workOrderContext
} from '../helpers/work-order-runtime';

const createRequest = Object.freeze({
  title: 'SLA测试工单', description: '验证响应和解决截止时间',
  serviceCode: 'SVC-1', priority: 'normal' as const
});

function create(database: any, service: WorkOrderService) {
  return database.transaction((connection: any) => service.create(
    createRequest,
    workOrderContext(connection, dispatcher)
  ));
}

function acceptAt(database: any, service: WorkOrderService, created: any, time: string) {
  const dispatched = database.transaction((connection: any) => service.dispatch({
    workOrderId: created.workOrderId, expectedVersion: created.version,
    handlerId: 'handler-01', reason: 'SLA测试派单'
  }, workOrderContext(connection, dispatcher)));
  return database.transaction((connection: any) => service.accept({
    workOrderId: created.workOrderId, expectedVersion: dispatched.version
  }, workOrderContext(connection, handler, { now: () => new Date(time) })));
}

function submit(database: any, service: WorkOrderService, created: any, accepted: any) {
  const recorded = database.transaction((connection: any) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: accepted.version, content: '执行处理'
  }, workOrderContext(connection, handler)));
  return database.transaction((connection: any) => service.submitResolution({
    workOrderId: created.workOrderId, expectedVersion: recorded.version, resolution: '处理完成'
  }, workOrderContext(connection, handler)));
}

test('evaluates pending and overdue SLA for unfinished work orders', (t) => {
  const { database } = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  const created = create(database, service);
  const beforeResponse = service.readSlaStatus(created.workOrderId, workOrderContext(
    database,
    dispatcher,
    { now: () => new Date('2026-09-17T08:30:00.000Z') }
  ));
  assert.deepEqual(beforeResponse, { response: 'pending', resolution: 'pending' });
  const afterResponse = service.readSlaStatus(created.workOrderId, workOrderContext(
    database,
    dispatcher,
    { now: () => new Date('2026-09-17T10:00:00.000Z') }
  ));
  assert.deepEqual(afterResponse, { response: 'overdue', resolution: 'pending' });

  const accepted = acceptAt(database, service, created, '2026-09-17T10:01:00.000Z');
  const afterResolution = service.readSlaStatus(created.workOrderId, workOrderContext(
    database,
    dispatcher,
    { now: () => new Date('2026-09-17T16:00:00.001Z') }
  ));
  assert.deepEqual(afterResolution, { response: 'overdue', resolution: 'overdue' });
  assert.equal(accepted.status, 'processing');
});

test('evaluates met and overdue SLA from persisted acceptance and close times', (t) => {
  const onTime = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  const onTimeCreated = create(onTime.database, service);
  const onTimeAccepted = acceptAt(
    onTime.database, service, onTimeCreated, '2026-09-17T08:30:00.000Z'
  );
  const onTimeSubmitted = submit(onTime.database, service, onTimeCreated, onTimeAccepted);
  onTime.database.transaction((connection) => service.approveClose({
    workOrderId: onTimeCreated.workOrderId,
    expectedVersion: onTimeSubmitted.version,
    comment: '按时关闭'
  }, workOrderContext(connection, reviewer, {
    now: () => new Date('2026-09-17T15:00:00.000Z')
  })));
  assert.deepEqual(service.readSlaStatus(onTimeCreated.workOrderId, workOrderContext(
    onTime.database, dispatcher, { now: () => new Date('2026-09-18T00:00:00.000Z') }
  )), { response: 'met', resolution: 'met' });

  const late = createWorkOrderTestRuntime(t);
  const lateCreated = create(late.database, service);
  const lateAccepted = acceptAt(late.database, service, lateCreated, '2026-09-17T09:00:00.001Z');
  const lateSubmitted = submit(late.database, service, lateCreated, lateAccepted);
  late.database.transaction((connection) => service.approveClose({
    workOrderId: lateCreated.workOrderId,
    expectedVersion: lateSubmitted.version,
    comment: '超时关闭'
  }, workOrderContext(connection, reviewer, {
    now: () => new Date('2026-09-17T16:00:00.001Z')
  })));
  assert.deepEqual(service.readSlaStatus(lateCreated.workOrderId, workOrderContext(
    late.database, dispatcher, { now: () => new Date('2026-09-18T00:00:00.000Z') }
  )), { response: 'overdue', resolution: 'overdue' });
});

test('reports deterministic dashboard counts for work order states', (t) => {
  const runtime = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  create(runtime.database, service);

  const processing = create(runtime.database, service);
  acceptAt(runtime.database, service, processing, '2026-09-17T08:30:00.000Z');

  const review = create(runtime.database, service);
  const reviewAccepted = acceptAt(runtime.database, service, review, '2026-09-17T08:30:00.000Z');
  submit(runtime.database, service, review, reviewAccepted);

  const closed = create(runtime.database, service);
  const closedAccepted = acceptAt(runtime.database, service, closed, '2026-09-17T08:30:00.000Z');
  const closedSubmitted = submit(runtime.database, service, closed, closedAccepted);
  runtime.database.transaction((connection) => service.approveClose({
    workOrderId: closed.workOrderId, expectedVersion: closedSubmitted.version, comment: '关闭'
  }, workOrderContext(connection, reviewer)));

  const metrics = new Map(
    new DashboardService(runtime.database, runtime.blueprint, runtime.schema)
      .read(dispatcher)
      .map((metric) => [metric.id, metric.value] as const)
  );
  assert.deepEqual(Object.fromEntries(metrics), {
    work_order_total: 4,
    work_order_pending_dispatch: 1,
    work_order_processing: 1,
    work_order_pending_review: 1,
    work_order_closed: 1
  });
});
