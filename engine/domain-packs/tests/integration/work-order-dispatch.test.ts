import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { evaluateDeadline } from '../../packs/work_order_service/runtime/sla';
import { WorkOrderService } from '../../packs/work_order_service/runtime/work-order-service';
import {
  createWorkOrderTestRuntime,
  dispatcher,
  handler,
  workOrderContext
} from '../helpers/work-order-runtime';

const createRequest = Object.freeze({
  title: '设备终端异常', description: '终端无法进入离线业务页面',
  serviceCode: 'SVC-1', priority: 'normal' as const
});

function createOrder(database: any, service: WorkOrderService) {
  return database.transaction((connection: any) => service.create(
    createRequest,
    workOrderContext(connection)
  ));
}

test('dispatches and redispatches with versioned events and audit', (t) => {
  const { database } = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  const created = createOrder(database, service);
  const audits: string[] = [];
  const first = database.transaction((connection: any) => service.dispatch({
    workOrderId: created.workOrderId,
    expectedVersion: 1,
    handlerId: 'handler-01',
    reason: '按服务组派单'
  }, workOrderContext(connection, dispatcher, {
    appendAudit: (_connection, entry) => audits.push(entry.permission)
  })));
  assert.equal(first.status, 'pending_acceptance');
  assert.equal(first.version, 2);
  assert.equal(first.handlerId, 'handler-01');

  const second = database.transaction((connection: any) => service.dispatch({
    workOrderId: created.workOrderId,
    expectedVersion: 2,
    handlerId: 'handler-02',
    reason: '调整处理岗位'
  }, workOrderContext(connection, dispatcher, {
    identityHasRole: (identityId, roleId) => identityId === 'handler-02' && roleId === 'work_order_handler',
    appendAudit: (_connection, entry) => audits.push(entry.permission)
  })));
  assert.equal(second.status, 'pending_acceptance');
  assert.equal(second.version, 3);
  assert.equal(second.handlerId, 'handler-02');
  assert.deepEqual(audits, ['work_orders.dispatch', 'work_orders.dispatch']);

  const events = database.prepare(
    'SELECT event_type, from_status, to_status FROM biz_work_order_event WHERE work_order_code = ? ORDER BY id'
  ).all(created.workOrderCode) as Array<Record<string, unknown>>;
  assert.deepEqual(events.map((row) => ({ ...row })), [
    { event_type: 'created', from_status: null, to_status: 'pending_dispatch' },
    { event_type: 'dispatched', from_status: 'pending_dispatch', to_status: 'pending_acceptance' },
    { event_type: 'dispatched', from_status: 'pending_acceptance', to_status: 'pending_acceptance' }
  ]);
});

test('accepts only by the current handler and records response SLA time', (t) => {
  const { database } = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  const created = createOrder(database, service);
  const dispatched = database.transaction((connection: any) => service.dispatch({
    workOrderId: created.workOrderId, expectedVersion: 1,
    handlerId: 'handler-01', reason: '派单'
  }, workOrderContext(connection)));
  const accepted = database.transaction((connection: any) => service.accept({
    workOrderId: created.workOrderId, expectedVersion: dispatched.version
  }, workOrderContext(connection, handler, {
    now: () => new Date('2026-09-17T08:30:00.000Z')
  })));
  assert.equal(accepted.status, 'processing');
  assert.equal(accepted.version, 3);
  assert.equal(accepted.acceptedAt, '2026-09-17T08:30:00.000Z');
  assert.equal(evaluateDeadline(
    accepted.acceptedAt,
    created.responseDueAt,
    new Date('2026-09-17T12:00:00.000Z')
  ), 'met');

  const lateRuntime = createWorkOrderTestRuntime(t);
  const lateCreated = createOrder(lateRuntime.database, service);
  const lateDispatched = lateRuntime.database.transaction((connection: any) => service.dispatch({
    workOrderId: lateCreated.workOrderId, expectedVersion: 1,
    handlerId: 'handler-01', reason: '派单'
  }, workOrderContext(connection)));
  const lateAccepted = lateRuntime.database.transaction((connection: any) => service.accept({
    workOrderId: lateCreated.workOrderId, expectedVersion: lateDispatched.version
  }, workOrderContext(connection, handler, {
    now: () => new Date('2026-09-17T09:00:00.001Z')
  })));
  assert.equal(evaluateDeadline(
    lateAccepted.acceptedAt,
    lateCreated.responseDueAt,
    new Date('2026-09-17T12:00:00.000Z')
  ), 'overdue');
});

test('rejects invalid handler, permission, actor, state and version', (t) => {
  const { database } = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  const created = createOrder(database, service);
  const dispatchRequest = {
    workOrderId: created.workOrderId, expectedVersion: 1,
    handlerId: 'missing-handler', reason: '派单'
  };
  assert.throws(() => database.transaction((connection: any) => service.dispatch(
    dispatchRequest,
    workOrderContext(connection, dispatcher, { identityHasRole: () => false })
  )), code('VALIDATION_FAILED'));
  assert.throws(() => database.transaction((connection: any) => service.dispatch(
    { ...dispatchRequest, handlerId: 'handler-01' },
    workOrderContext(connection, dispatcher, {
      requirePermission: () => { throw new AppError('PERMISSION_DENIED', 'denied'); }
    })
  )), code('PERMISSION_DENIED'));

  const dispatched = database.transaction((connection: any) => service.dispatch({
    ...dispatchRequest, handlerId: 'handler-01'
  }, workOrderContext(connection)));
  assert.throws(() => database.transaction((connection: any) => service.accept({
    workOrderId: created.workOrderId, expectedVersion: dispatched.version
  }, workOrderContext(connection, {
    userId: 4, username: 'handler-02', displayName: '其他处理岗位', roleId: 'work_order_handler'
  }, { identityHasRole: () => true }))), code('PERMISSION_DENIED'));
  assert.throws(() => database.transaction((connection: any) => service.accept({
    workOrderId: created.workOrderId, expectedVersion: 99
  }, workOrderContext(connection, handler))), code('VERSION_CONFLICT'));

  const accepted = database.transaction((connection: any) => service.accept({
    workOrderId: created.workOrderId, expectedVersion: dispatched.version
  }, workOrderContext(connection, handler)));
  assert.throws(() => database.transaction((connection: any) => service.dispatch({
    ...dispatchRequest, expectedVersion: accepted.version, handlerId: 'handler-01'
  }, workOrderContext(connection))), code('INVALID_TRANSITION'));
});

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
