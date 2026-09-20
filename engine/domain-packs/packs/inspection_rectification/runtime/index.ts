import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type { PluginContributionSink, PluginDescriptor } from '../../../../desktop-runtime/src/core/plugin-registry';
import { inspectionUiDescriptor } from '../ui/index';
import { runInspectionAcceptanceScenario } from '../tests/index';
import { inspectionDomainActions } from './action-adapter';
import { InspectionService } from './inspection-service';

export * from './types';
export * from './inspection-service';

const register = (registry: PluginContributionSink, id: string, value: unknown) => (
  registry.register('inspection_rectification', id, value)
);

const ipc = Object.freeze([
  ['inspection.plan.create', 'createPlan', 'inspection_plans.create_plan'],
  ['inspection.plan.update', 'updatePlan', 'inspection_plans.update_plan'],
  ['inspection.task.create', 'createTask', 'inspection_tasks.create_task'],
  ['inspection.assign', 'assignExecutor', 'inspection_tasks.assign'],
  ['inspection.start', 'startTask', 'inspection_tasks.execute'],
  ['inspection.record', 'recordItemResult', 'inspection_items.record_result'],
  ['inspection.submit', 'submitReview', 'inspection_tasks.submit'],
  ['inspection.reject', 'rejectReview', 'inspection_tasks.review'],
  ['inspection.archive', 'archiveTask', 'inspection_tasks.review'],
  ['inspection.task_summary', 'readTaskSummary', 'inspection_tasks.view'],
  ['inspection.dashboard_summary', 'readDashboardSummary', 'inspection_tasks.view']
] as const);

export const inspectionRuntimeDescriptor = Object.freeze({
  id: 'inspection_rectification',
  version: '1.0.0',
  blueprintSchemaVersions: Object.freeze(['1.0']),
  runtimeVersions: Object.freeze(['1.0.0']),
  validateConfig: (config) => {
    if (Object.keys(config).length) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Inspection configuration contains unsupported properties.');
    }
  },
  registerMigrations: (registry) => register(
    registry,
    'inspection_rectification.v1',
    Object.freeze({ version: 1, owner: 'inspection_rectification' })
  ),
  registerServices: (registry) => register(
    registry,
    'inspection.lifecycle',
    Object.freeze({ create: () => new InspectionService() })
  ),
  registerIpc: (registry) => {
    for (const [id, method, permission] of ipc) {
      register(registry, id, Object.freeze({ service: 'inspection.lifecycle', method, permission }));
    }
  },
  registerDomainActions: (registry) => {
    for (const action of inspectionDomainActions) register(registry, action.id, action);
  },
  registerUiExtensions: (registry) => {
    for (const extension of inspectionUiDescriptor.extensions) register(registry, extension.id, extension);
  },
  registerAcceptanceScenarios: (registry) => register(
    registry,
    'inspection.lifecycle.acceptance',
    runInspectionAcceptanceScenario
  )
} satisfies PluginDescriptor & { readonly runtimeVersions: readonly string[] });
