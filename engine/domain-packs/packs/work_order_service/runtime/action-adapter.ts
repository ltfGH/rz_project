import { createServiceActions, type PluginActionContext } from '../../../src/runtime/action-types';
import type { WorkOrderContext } from './types';
import { WorkOrderService } from './work-order-service';

export function workOrderDomainContext(source: PluginActionContext): WorkOrderContext {
  return {
    connection: source.connection,
    actor: source.actor,
    requirePermission: source.requirePermission,
    appendAudit: (connection, entry) => source.appendAudit(connection, entry),
    identityHasRole: source.identityHasRole,
    now: source.now,
    orderCode: () => source.nextCode('work_order'),
    eventCode: () => source.nextCode('work_order_event')
  };
}

export const workOrderDomainActions = createServiceActions(
  new WorkOrderService(),
  workOrderDomainContext,
  [
    { id: 'sla_policy.create', method: 'createSlaPolicy', permission: 'sla_policies.create_policy' },
    { id: 'sla_policy.update', method: 'updateSlaPolicy', permission: 'sla_policies.update_policy' },
    { id: 'work_order.create', method: 'create', permission: 'work_orders.create_order' },
    { id: 'work_order.dispatch', method: 'dispatch', permission: 'work_orders.dispatch' },
    { id: 'work_order.accept', method: 'accept', permission: 'work_orders.accept' },
    { id: 'work_order.add_processing_record', method: 'addProcessingRecord', permission: 'work_orders.add_processing_record' },
    { id: 'work_order.submit_resolution', method: 'submitResolution', permission: 'work_orders.submit_resolution' },
    { id: 'work_order.reject_review', method: 'rejectReview', permission: 'work_orders.review' },
    { id: 'work_order.approve_close', method: 'approveClose', permission: 'work_orders.review' },
    { id: 'work_order.sla_status', method: 'readSlaStatus', permission: 'work_orders.view', idField: 'workOrderId' },
    { id: 'work_order.dashboard_summary', method: 'readDashboardSummary', permission: 'work_orders.view', invocation: 'context' }
  ]
);
