import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { WorkOrderService } from '../../packs/work_order_service/runtime/work-order-service';
import {
  createWorkOrderTestRuntime,
  dispatcher,
  workOrderContext
} from '../helpers/work-order-runtime';

const request = Object.freeze({
  title: '终端无法登录',
  description: '离线终端启动后无法进入业务系统',
  serviceCode: 'SVC-1',
  priority: 'normal' as const
});

test('creates a pending work order with fixed SLA, event and audit', (t) => {
  const { database } = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  const audits: string[] = [];
  const result = database.transaction((connection) => service.create(request, workOrderContext(
    connection,
    dispatcher,
    { appendAudit: (_connection, entry) => audits.push(entry.permission) }
  )));

  assert.equal(result.status, 'pending_dispatch');
  assert.equal(result.version, 1);
  assert.equal(result.slaPolicyCode, 'SLA-1');
  assert.equal(result.responseDueAt, '2026-09-17T09:00:00.000Z');
  assert.equal(result.resolutionDueAt, '2026-09-17T16:00:00.000Z');
  assert.deepEqual(audits, ['work_orders.create_order']);
  const row = database.prepare(
    'SELECT status, requester_id, handler_id, response_due_at, resolution_due_at FROM biz_work_order WHERE id = ?'
  ).get(result.workOrderId) as Record<string, unknown>;
  assert.deepEqual({ ...row }, {
    status: 'pending_dispatch', requester_id: 'dispatcher-01', handler_id: null,
    response_due_at: result.responseDueAt, resolution_due_at: result.resolutionDueAt
  });
  const events = database.prepare(
    "SELECT event_type, to_status FROM biz_work_order_event WHERE work_order_code = ?"
  ).all(result.workOrderCode) as Array<Record<string, unknown>>;
  assert.deepEqual(events.map((event) => ({ ...event })), [
    { event_type: 'created', to_status: 'pending_dispatch' }
  ]);
});

test('rejects disabled services and missing or ambiguous active SLA policies', (t) => {
  const service = new WorkOrderService();
  const disabled = createWorkOrderTestRuntime(t, { serviceActive: false });
  assert.throws(() => disabled.database.transaction((connection) => (
    service.create(request, workOrderContext(connection))
  )), code('VALIDATION_FAILED'));

  const missing = createWorkOrderTestRuntime(t, { slaCount: 0 });
  assert.throws(() => missing.database.transaction((connection) => (
    service.create(request, workOrderContext(connection))
  )), code('VALIDATION_FAILED'));

  const ambiguous = createWorkOrderTestRuntime(t, { slaCount: 2 });
  assert.throws(() => ambiguous.database.transaction((connection) => (
    service.create(request, workOrderContext(connection))
  )), code('VALIDATION_FAILED'));
});

test('rejects permission and input failures before writing', (t) => {
  const { database } = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  assert.throws(() => database.transaction((connection) => service.create(
    request,
    workOrderContext(connection, dispatcher, {
      requirePermission: () => { throw new AppError('PERMISSION_DENIED', 'denied'); }
    })
  )), code('PERMISSION_DENIED'));
  assert.throws(() => database.transaction((connection) => service.create(
    { ...request, title: '   ' },
    workOrderContext(connection)
  )), code('VALIDATION_FAILED'));
  const count = database.prepare('SELECT COUNT(*) AS count FROM biz_work_order').get() as { count: number };
  assert.equal(count.count, 0);
});

test('rolls back the work order and event when audit append fails', (t) => {
  const { database } = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  assert.throws(() => database.transaction((connection) => service.create(
    request,
    workOrderContext(connection, dispatcher, {
      appendAudit: () => { throw new Error('audit failed'); }
    })
  )), /audit failed/);
  const row = database.prepare(
    `SELECT
      (SELECT COUNT(*) FROM biz_work_order) AS work_order_count,
      (SELECT COUNT(*) FROM biz_work_order_event) AS event_count`
  ).get() as { work_order_count: number; event_count: number };
  assert.deepEqual({ ...row }, { work_order_count: 0, event_count: 0 });
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
