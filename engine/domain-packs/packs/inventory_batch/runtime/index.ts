import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type { PluginContributionSink, PluginDescriptor } from '../../../../desktop-runtime/src/core/plugin-registry';
import { inventoryUiDescriptor } from '../ui/index';
import { runInventoryAcceptanceScenario } from '../tests/index';
import { InventoryService } from './inventory-service';

export * from './types';
export * from './inventory-service';

const register = (registry: PluginContributionSink, id: string, value: unknown) => registry.register('inventory_batch', id, value);

export const inventoryRuntimeDescriptor = Object.freeze({
  id: 'inventory_batch',
  version: '1.0.0',
  blueprintSchemaVersions: Object.freeze(['1.0']),
  runtimeVersions: Object.freeze(['1.0.0']),
  validateConfig: (config) => {
    if (Object.keys(config).length !== 1 || !Object.hasOwn(config, 'quantity_scale')) throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Inventory configuration requires quantity_scale only.');
    const scale = config.quantity_scale;
    if (!Number.isInteger(scale) || Number(scale) < 0 || Number(scale) > 6) throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Inventory quantity_scale must be an integer from 0 to 6.');
  },
  registerMigrations: (registry) => register(registry, 'inventory_batch.v1', Object.freeze({ version: 1, owner: 'inventory_batch' })),
  registerServices: (registry) => register(registry, 'inventory.lifecycle', Object.freeze({ create: () => new InventoryService() })),
  registerIpc: (registry) => {
    for (const [id, method, permission] of [
      ['inventory.material.create', 'createMaterial', 'materials.create_material'],
      ['inventory.material.update', 'updateMaterial', 'materials.update_material'],
      ['inventory.warehouse.create', 'createWarehouse', 'warehouses.create_warehouse'],
      ['inventory.warehouse.update', 'updateWarehouse', 'warehouses.update_warehouse'],
      ['inventory.batch.receive_new', 'receiveNewBatch', 'inventory_batches.receive_new'],
      ['inventory.batch.receive_existing', 'receiveExistingBatch', 'inventory_batches.receive_existing'],
      ['inventory.batch.issue', 'issueStock', 'inventory_batches.issue'],
      ['inventory.batch.return', 'returnStock', 'inventory_batches.return_stock'],
      ['inventory.batch.adjust', 'adjustStock', 'inventory_batches.adjust'],
      ['inventory.batch.delete_guard', 'assertCanDeleteBatch', 'inventory_batches.view'],
      ['inventory.expiry', 'readExpiryWarnings', 'inventory_batches.view'],
      ['inventory.dashboard_summary', 'readInventorySummary', 'inventory_batches.view']
    ] as const) register(registry, id, Object.freeze({ service: 'inventory.lifecycle', method, permission }));
  },
  registerUiExtensions: (registry) => { for (const extension of inventoryUiDescriptor.extensions) register(registry, extension.id, extension); },
  registerAcceptanceScenarios: (registry) => register(registry, 'inventory.lifecycle.acceptance', runInventoryAcceptanceScenario)
} satisfies PluginDescriptor & { readonly runtimeVersions: readonly string[] });
