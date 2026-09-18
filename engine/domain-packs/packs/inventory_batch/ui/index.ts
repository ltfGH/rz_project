const extensions = Object.freeze([
  Object.freeze({ id: 'inventory.ledger.tab', slot: 'entity.detail.tabs', entityId: 'inventory_batch', label: '库存流水', order: 20, viewId: 'inventory_ledger' }),
  Object.freeze({ id: 'inventory.issue_return.tab', slot: 'entity.detail.tabs', entityId: 'inventory_batch', label: '领用与退库', order: 30, viewId: 'inventory_issue_return' }),
  Object.freeze({ id: 'inventory.expiry.tab', slot: 'entity.detail.tabs', entityId: 'inventory_batch', label: '效期状态', order: 40, viewId: 'inventory_expiry' }),
  Object.freeze({ id: 'inventory.batch.actions', slot: 'entity.detail.actions', entityId: 'inventory_batch', label: '库存操作', order: 10, actionIds: Object.freeze(['inventory.batch.receive_existing', 'inventory.batch.issue', 'inventory.batch.return', 'inventory.batch.adjust']) }),
  Object.freeze({ id: 'inventory.config.actions', slot: 'entity.detail.actions', entityId: 'material', label: '基础资料', order: 10, actionIds: Object.freeze(['inventory.material.create', 'inventory.material.update', 'inventory.warehouse.create', 'inventory.warehouse.update']) }),
  Object.freeze({ id: 'inventory.dashboard', slot: 'dashboard.sections', label: '库存概览', order: 20, viewId: 'inventory_dashboard', dataSource: 'inventory.dashboard_summary' })
]);

export const inventoryUiDescriptor = Object.freeze({
  id: 'inventory_batch',
  version: '1.0.0',
  slots: Object.freeze(['entity.detail.tabs', 'entity.detail.actions', 'dashboard.sections'] as const),
  extensions
});
