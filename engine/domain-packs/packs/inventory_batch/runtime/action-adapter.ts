import { createServiceActions, type PluginActionContext } from '../../../src/runtime/action-types';
import { InventoryService } from './inventory-service';
import type { InventoryContext, InventoryIssueBlocker } from './types';

export function inventoryDomainContext(source: PluginActionContext): InventoryContext {
  return {
    connection: source.connection,
    actor: source.actor,
    quantityScale: Number(source.pluginConfig('inventory_batch').quantity_scale),
    requirePermission: source.requirePermission,
    appendAudit: (connection, entry) => source.appendAudit(connection, entry),
    identityHasRole: source.identityHasRole,
    issueBlockers: source.extensions.values<InventoryIssueBlocker>('inventory.issue.blockers'),
    now: source.now,
    materialCode: () => source.nextCode('material'),
    warehouseCode: () => source.nextCode('warehouse'),
    batchCode: () => source.nextCode('inventory_batch'),
    transactionCode: () => source.nextCode('inventory_transaction')
  };
}

export const inventoryDomainActions = createServiceActions(
  new InventoryService(),
  inventoryDomainContext,
  [
    { id: 'inventory.material.create', method: 'createMaterial', permission: 'materials.create_material' },
    { id: 'inventory.material.update', method: 'updateMaterial', permission: 'materials.update_material' },
    { id: 'inventory.warehouse.create', method: 'createWarehouse', permission: 'warehouses.create_warehouse' },
    { id: 'inventory.warehouse.update', method: 'updateWarehouse', permission: 'warehouses.update_warehouse' },
    { id: 'inventory.batch.receive_new', method: 'receiveNewBatch', permission: 'inventory_batches.receive_new' },
    { id: 'inventory.batch.receive_existing', method: 'receiveExistingBatch', permission: 'inventory_batches.receive_existing' },
    { id: 'inventory.batch.issue', method: 'issueStock', permission: 'inventory_batches.issue' },
    { id: 'inventory.batch.return', method: 'returnStock', permission: 'inventory_batches.return_stock' },
    { id: 'inventory.batch.adjust', method: 'adjustStock', permission: 'inventory_batches.adjust' },
    { id: 'inventory.batch.delete_guard', method: 'assertCanDeleteBatch', permission: 'inventory_batches.view', idField: 'batchId' },
    { id: 'inventory.expiry', method: 'readExpiryWarnings', permission: 'inventory_batches.view', invocation: 'context' },
    { id: 'inventory.dashboard_summary', method: 'readInventorySummary', permission: 'inventory_batches.view', invocation: 'context' }
  ]
);
