import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type { PluginContributionSink, PluginDescriptor } from '../../../../desktop-runtime/src/core/plugin-registry';
import { projectUiDescriptor } from '../ui/index';
import { runProjectAcceptanceScenario } from '../tests/index';
import { projectDomainActions } from './action-adapter';
import { ProjectService } from './project-service';

export * from './types';
export * from './project-service';

const register = (sink: PluginContributionSink, id: string, value: unknown) => (
  sink.register('project_task', id, value)
);

const ipc = Object.freeze([
  ['project.create', 'createProject', 'projects.create_project'],
  ['project.update', 'updateProject', 'projects.update_project'],
  ['project.activate', 'activateProject', 'projects.activate'],
  ['project.request_close', 'requestProjectClose', 'projects.request_close'],
  ['project.reject_close', 'rejectProjectClose', 'projects.reject_close'],
  ['project.approve_close', 'approveProjectClose', 'projects.approve_close'],
  ['project.summary', 'readProjectSummary', 'projects.summary'],
  ['project.dashboard_summary', 'readProjectDashboard', 'projects.summary'],
  ['project.milestone.create', 'createMilestone', 'milestones.create_milestone'],
  ['project.milestone.complete', 'completeMilestone', 'milestones.complete'],
  ['project.task.create', 'createTask', 'project_tasks.create_task'],
  ['project.task.update', 'updatePendingTask', 'project_tasks.update_task'],
  ['project.task.start', 'startTask', 'project_tasks.start'],
  ['project.task.progress', 'addTaskProgress', 'project_tasks.add_progress'],
  ['project.task.submit', 'submitTaskReview', 'project_tasks.submit'],
  ['project.task.reject', 'rejectTaskReview', 'project_tasks.reject'],
  ['project.task.approve', 'approveTask', 'project_tasks.approve'],
  ['project.task.cancel', 'cancelTask', 'project_tasks.cancel'],
  ['project.task.restore', 'restoreTask', 'project_tasks.restore'],
  ['project.risk.create', 'createRisk', 'project_risks.create_risk'],
  ['project.risk.mitigate', 'mitigateRisk', 'project_risks.mitigate'],
  ['project.risk.close', 'closeRisk', 'project_risks.close'],
  ['project.risk.reopen', 'reopenRisk', 'project_risks.reopen'],
  ['project.deliverable.submit', 'submitDeliverable', 'deliverables.submit'],
  ['project.deliverable.review', 'reviewDeliverable', 'deliverables.review']
] as const);

export const projectRuntimeDescriptor = Object.freeze({
  id: 'project_task',
  version: '1.0.0',
  blueprintSchemaVersions: Object.freeze(['1.0']),
  runtimeVersions: Object.freeze(['1.0.0']),
  validateConfig: (config) => {
    if (Object.keys(config).length) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Project plugin configuration contains unsupported properties.');
    }
  },
  registerMigrations: (sink) => register(
    sink,
    'project_task.v1',
    Object.freeze({ version: 1, owner: 'project_task' })
  ),
  registerServices: (sink) => register(
    sink,
    'project.lifecycle',
    Object.freeze({ create: () => new ProjectService() })
  ),
  registerIpc: (sink) => {
    for (const [id, method, permission] of ipc) {
      register(sink, id, Object.freeze({ service: 'project.lifecycle', method, permission }));
    }
  },
  registerDomainActions: (sink) => {
    for (const action of projectDomainActions) register(sink, action.id, action);
  },
  registerUiExtensions: (sink) => {
    for (const extension of projectUiDescriptor.extensions) register(sink, extension.id, extension);
  },
  registerAcceptanceScenarios: (sink) => register(
    sink,
    'project.lifecycle.acceptance',
    runProjectAcceptanceScenario
  )
} satisfies PluginDescriptor & { readonly runtimeVersions: readonly string[] });
