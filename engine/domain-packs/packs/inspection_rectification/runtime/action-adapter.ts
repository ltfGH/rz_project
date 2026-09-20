import { createServiceActions, type PluginActionContext } from '../../../src/runtime/action-types';
import { InspectionService } from './inspection-service';
import type {
  InspectionAbnormalHandler,
  InspectionArchiveBlocker,
  InspectionContext
} from './types';

function context(source: PluginActionContext): InspectionContext {
  return {
    connection: source.connection,
    actor: source.actor,
    requirePermission: source.requirePermission,
    appendAudit: (connection, entry) => source.appendAudit(connection, entry),
    identityHasRole: source.identityHasRole,
    archiveBlockers: source.extensions.values<InspectionArchiveBlocker>('inspection.archive.blockers'),
    abnormalHandlers: source.extensions.values<InspectionAbnormalHandler>('inspection.abnormal.handlers'),
    commandBus: source.commandBus,
    now: source.now,
    planCode: () => source.nextCode('inspection_plan'),
    taskCode: () => source.nextCode('inspection_task'),
    itemCode: () => source.nextCode('inspection_item'),
    eventCode: () => source.nextCode('inspection_event')
  };
}

export const inspectionDomainActions = createServiceActions(
  new InspectionService(),
  context,
  [
    { id: 'inspection.plan.create', method: 'createPlan', permission: 'inspection_plans.create_plan' },
    { id: 'inspection.plan.update', method: 'updatePlan', permission: 'inspection_plans.update_plan' },
    { id: 'inspection.task.create', method: 'createTask', permission: 'inspection_tasks.create_task' },
    { id: 'inspection.assign', method: 'assignExecutor', permission: 'inspection_tasks.assign' },
    { id: 'inspection.start', method: 'startTask', permission: 'inspection_tasks.execute' },
    { id: 'inspection.record', method: 'recordItemResult', permission: 'inspection_items.record_result' },
    { id: 'inspection.submit', method: 'submitReview', permission: 'inspection_tasks.submit' },
    { id: 'inspection.reject', method: 'rejectReview', permission: 'inspection_tasks.review' },
    { id: 'inspection.archive', method: 'archiveTask', permission: 'inspection_tasks.review' },
    { id: 'inspection.task_summary', method: 'readTaskSummary', permission: 'inspection_tasks.view', idField: 'taskId' },
    { id: 'inspection.dashboard_summary', method: 'readDashboardSummary', permission: 'inspection_tasks.view', invocation: 'context' }
  ]
);
