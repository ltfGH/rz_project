import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type { PluginContributionSink, PluginDescriptor } from '../../../../desktop-runtime/src/core/plugin-registry';
import type { PluginActionContext, PluginDomainAction } from '../../../src/runtime/action-types';
import type { JsonObject } from '../../../src/runtime/types';
import type { WorkOrderContext } from '../../work_order_service/runtime/types';
import { assetWorkOrderUiDescriptor } from '../ui/index';
import { runAssetWorkOrderAcceptanceScenario } from '../tests/index';
import {
  createAssetLinkedWorkOrder,
  createOpenWorkOrderAssetBlocker
} from './asset-work-order';

const PLUGIN_ID = 'asset_work_order_bridge';

function register(sink: PluginContributionSink, id: string, value: unknown): void {
  sink.register(PLUGIN_ID, id, value);
}

function workOrderContext(source: PluginActionContext): WorkOrderContext {
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

export const createAssetWorkOrderAction: PluginDomainAction = Object.freeze({
  id: 'asset.work_order.create',
  permission: 'work_orders.create_order',
  parse: (payload: JsonObject) => payload,
  execute: (context: PluginActionContext, payload: JsonObject) => (
    createAssetLinkedWorkOrder(payload as never, workOrderContext(context)) as never
  )
});

export const assetWorkOrderRuntimeDescriptor = Object.freeze({
  id: PLUGIN_ID,
  version: '1.0.0',
  blueprintSchemaVersions: Object.freeze(['1.0']),
  runtimeVersions: Object.freeze(['1.0.0']),
  validateConfig: (config) => {
    if (Object.keys(config).length) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Asset work order bridge does not accept configuration.');
    }
  },
  registerMigrations: (sink) => register(
    sink,
    'asset_work_order_bridge.v1',
    Object.freeze({ version: 1, owner: PLUGIN_ID })
  ),
  registerServices: (sink) => register(
    sink,
    'asset.work_order.bridge',
    Object.freeze({ createAssetLinkedWorkOrder })
  ),
  registerIpc: (sink) => register(sink, createAssetWorkOrderAction.id, Object.freeze({
    service: 'asset.work_order.bridge',
    method: 'createAssetLinkedWorkOrder',
    permission: createAssetWorkOrderAction.permission
  })),
  registerDomainActions: (sink) => register(
    sink,
    createAssetWorkOrderAction.id,
    createAssetWorkOrderAction
  ),
  registerLifecycleBlockers: (sink) => register(
    sink,
    'asset.deactivation.work_order',
    createOpenWorkOrderAssetBlocker()
  ),
  registerUiExtensions: (sink) => {
    for (const extension of assetWorkOrderUiDescriptor.extensions) {
      register(sink, extension.id, extension);
    }
  },
  registerAcceptanceScenarios: (sink) => register(
    sink,
    'asset.work_order.acceptance',
    runAssetWorkOrderAcceptanceScenario
  )
} satisfies PluginDescriptor & { readonly runtimeVersions: readonly string[] });

export * from './asset-work-order';
