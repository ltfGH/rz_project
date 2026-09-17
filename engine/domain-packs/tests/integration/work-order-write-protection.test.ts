import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { WorkOrderService } from '../../packs/work_order_service/runtime/work-order-service';
import {
  createWorkOrderTestRuntime,
  dispatcher,
  workOrderContext
} from '../helpers/work-order-runtime';

test('blocks generic creation and updates for work orders and events', (t) => {
  const { database, repository } = createWorkOrderTestRuntime(t);
  const service = new WorkOrderService();
  const created = database.transaction((connection) => service.create({
    title: '写保护测试', description: '验证通用仓储不能绕过领域服务',
    serviceCode: 'SVC-1', priority: 'normal'
  }, workOrderContext(connection, dispatcher)));

  assert.throws(() => repository.create('work_order', {}, dispatcher), permissionDenied);
  assert.throws(() => repository.update(
    'work_order', created.workOrderId, created.version, { status: 'closed' }, dispatcher
  ), permissionDenied);
  assert.throws(() => repository.create('work_order_event', {}, dispatcher), permissionDenied);
  const event = database.prepare(
    'SELECT id, version FROM biz_work_order_event WHERE work_order_code = ?'
  ).get(created.workOrderCode) as { id: number; version: number };
  assert.throws(() => repository.update(
    'work_order_event', event.id, event.version, { content: '篡改历史' }, dispatcher
  ), permissionDenied);

  const row = database.prepare(
    'SELECT status, version FROM biz_work_order WHERE id = ?'
  ).get(created.workOrderId) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { status: 'pending_dispatch', version: 1 });
  const eventCount = database.prepare(
    'SELECT COUNT(*) AS count FROM biz_work_order_event'
  ).get() as { count: number };
  assert.equal(eventCount.count, 1);
});

function permissionDenied(error: unknown): boolean {
  return error instanceof AppError && error.code === 'PERMISSION_DENIED';
}
