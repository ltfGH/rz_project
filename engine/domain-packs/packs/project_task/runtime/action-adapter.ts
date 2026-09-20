import { createServiceActions, type PluginActionContext } from '../../../src/runtime/action-types';
import { ProjectService } from './project-service';
import type { ProjectCloseBlocker, ProjectContext } from './types';

function context(source: PluginActionContext): ProjectContext {
  return {
    connection: source.connection,
    actor: source.actor,
    requirePermission: source.requirePermission,
    appendAudit: (connection, entry) => source.appendAudit(connection, entry),
    identityHasRole: source.identityHasRole,
    closeBlockers: source.extensions.values<ProjectCloseBlocker>('project.close.blockers'),
    now: source.now,
    projectCode: () => source.nextCode('project'),
    milestoneCode: () => source.nextCode('milestone'),
    taskCode: () => source.nextCode('project_task'),
    riskCode: () => source.nextCode('project_risk'),
    deliverableCode: () => source.nextCode('deliverable'),
    eventCode: () => source.nextCode('project_event')
  };
}

export const projectDomainActions = createServiceActions(
  new ProjectService(),
  context,
  [
    { id: 'project.create', method: 'createProject', permission: 'projects.create_project' },
    { id: 'project.update', method: 'updateProject', permission: 'projects.update_project' },
    { id: 'project.activate', method: 'activateProject', permission: 'projects.activate' },
    { id: 'project.request_close', method: 'requestProjectClose', permission: 'projects.request_close' },
    { id: 'project.reject_close', method: 'rejectProjectClose', permission: 'projects.reject_close' },
    { id: 'project.approve_close', method: 'approveProjectClose', permission: 'projects.approve_close' },
    { id: 'project.summary', method: 'readProjectSummary', permission: 'projects.summary', idField: 'projectId' },
    { id: 'project.dashboard_summary', method: 'readProjectDashboard', permission: 'projects.summary', invocation: 'context' },
    { id: 'project.milestone.create', method: 'createMilestone', permission: 'milestones.create_milestone' },
    { id: 'project.milestone.complete', method: 'completeMilestone', permission: 'milestones.complete' },
    { id: 'project.task.create', method: 'createTask', permission: 'project_tasks.create_task' },
    { id: 'project.task.update', method: 'updatePendingTask', permission: 'project_tasks.update_task' },
    { id: 'project.task.start', method: 'startTask', permission: 'project_tasks.start' },
    { id: 'project.task.progress', method: 'addTaskProgress', permission: 'project_tasks.add_progress' },
    { id: 'project.task.submit', method: 'submitTaskReview', permission: 'project_tasks.submit' },
    { id: 'project.task.reject', method: 'rejectTaskReview', permission: 'project_tasks.reject' },
    { id: 'project.task.approve', method: 'approveTask', permission: 'project_tasks.approve' },
    { id: 'project.task.cancel', method: 'cancelTask', permission: 'project_tasks.cancel' },
    { id: 'project.task.restore', method: 'restoreTask', permission: 'project_tasks.restore' },
    { id: 'project.risk.create', method: 'createRisk', permission: 'project_risks.create_risk' },
    { id: 'project.risk.mitigate', method: 'mitigateRisk', permission: 'project_risks.mitigate' },
    { id: 'project.risk.close', method: 'closeRisk', permission: 'project_risks.close' },
    { id: 'project.risk.reopen', method: 'reopenRisk', permission: 'project_risks.reopen' },
    { id: 'project.deliverable.submit', method: 'submitDeliverable', permission: 'deliverables.submit' },
    { id: 'project.deliverable.review', method: 'reviewDeliverable', permission: 'deliverables.review' }
  ]
);
