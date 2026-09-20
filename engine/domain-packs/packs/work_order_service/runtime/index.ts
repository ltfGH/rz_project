import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type {
  PluginContributionSink,
  PluginDescriptor
} from '../../../../desktop-runtime/src/core/plugin-registry';
import { runWorkOrderAcceptanceScenario } from '../tests/index';
import { workOrderUiDescriptor } from '../ui/index';
import { workOrderDomainActions } from './action-adapter';

export * from './sla';
export * from './types';
export * from './work-order-service';

import { WorkOrderService } from './work-order-service';

function register(
  registry: PluginContributionSink,
  contributionId: string,
  contribution: unknown
): void {
  registry.register('work_order_service', contributionId, contribution);
}

export const workOrderRuntimeDescriptor = Object.freeze({
  id: 'work_order_service',
  version: '1.0.0',
  blueprintSchemaVersions: Object.freeze(['1.0']),
  runtimeVersions: Object.freeze(['1.0.0']),
  validateConfig: (config) => {
    if (Object.keys(config).length > 0) {
      throw new AppError(
        'BLUEPRINT_INCOMPATIBLE',
        'Work order service configuration contains unsupported properties.'
      );
    }
  },
  registerMigrations: (registry) => register(
    registry,
    'work_order_service.v1',
    Object.freeze({ version: 1, owner: 'work_order_service' })
  ),
  registerServices: (registry) => register(
    registry,
    'work_order.lifecycle',
    Object.freeze({ create: () => new WorkOrderService() })
  ),
  registerIpc: (registry) => {
    const commands = [
      ['sla_policy.create', 'createSlaPolicy', 'sla_policies.create_policy'],
      ['sla_policy.update', 'updateSlaPolicy', 'sla_policies.update_policy'],
      ['work_order.create', 'create', 'work_orders.create_order'],
      ['work_order.dispatch', 'dispatch', 'work_orders.dispatch'],
      ['work_order.accept', 'accept', 'work_orders.accept'],
      ['work_order.add_processing_record', 'addProcessingRecord', 'work_orders.add_processing_record'],
      ['work_order.submit_resolution', 'submitResolution', 'work_orders.submit_resolution'],
      ['work_order.reject_review', 'rejectReview', 'work_orders.review'],
      ['work_order.approve_close', 'approveClose', 'work_orders.review'],
      ['work_order.sla_status', 'readSlaStatus', 'work_orders.view'],
      ['work_order.dashboard_summary', 'readDashboardSummary', 'work_orders.view']
    ] as const;
    for (const [id, method, permission] of commands) {
      register(registry, id, Object.freeze({
        service: 'work_order.lifecycle', method, permission
      }));
    }
  },
  registerDomainActions: (registry) => {
    for (const action of workOrderDomainActions) register(registry, action.id, action);
  },
  registerUiExtensions: (registry) => {
    for (const extension of workOrderUiDescriptor.extensions) {
      register(registry, extension.id, extension);
    }
  },
  registerAcceptanceScenarios: (registry) => register(
    registry,
    'work_order.lifecycle.acceptance',
    runWorkOrderAcceptanceScenario
  )
} satisfies PluginDescriptor & { readonly runtimeVersions: readonly string[] });
