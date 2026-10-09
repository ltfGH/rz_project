const extensions = Object.freeze([
  Object.freeze({ id: 'inventory.ledger.tab', slot: 'entity.detail.tabs', entityId: 'inventory_batch', label: '库存流水', order: 20, viewId: 'inventory_ledger' }),
  Object.freeze({ id: 'inventory.issue_return.tab', slot: 'entity.detail.tabs', entityId: 'inventory_batch', label: '领用与退库', order: 30, viewId: 'inventory_issue_return' }),
  Object.freeze({ id: 'inventory.expiry.tab', slot: 'entity.detail.tabs', entityId: 'inventory_batch', label: '效期状态', order: 40, viewId: 'inventory_expiry' }),
  Object.freeze({ id: 'inventory.material.module.actions', slot: 'entity.module.actions', entityId: 'material', label: '物料操作', order: 10, actionIds: Object.freeze(['inventory.material.create']) }),
  Object.freeze({ id: 'inventory.warehouse.module.actions', slot: 'entity.module.actions', entityId: 'warehouse', label: '仓库操作', order: 10, actionIds: Object.freeze(['inventory.warehouse.create']) }),
  Object.freeze({ id: 'inventory.batch.module.actions', slot: 'entity.module.actions', entityId: 'inventory_batch', label: '批次操作', order: 10, actionIds: Object.freeze(['inventory.batch.receive_new']) }),
  Object.freeze({ id: 'inventory.material.actions', slot: 'entity.detail.actions', entityId: 'material', label: '物料操作', order: 10, actionIds: Object.freeze(['inventory.material.update']) }),
  Object.freeze({ id: 'inventory.warehouse.actions', slot: 'entity.detail.actions', entityId: 'warehouse', label: '仓库操作', order: 10, actionIds: Object.freeze(['inventory.warehouse.update']) }),
  Object.freeze({ id: 'inventory.batch.actions', slot: 'entity.detail.actions', entityId: 'inventory_batch', label: '库存操作', order: 10, actionIds: Object.freeze(['inventory.batch.receive_existing', 'inventory.batch.issue', 'inventory.batch.return', 'inventory.batch.adjust']) }),
  Object.freeze({ id: 'inventory.dashboard', slot: 'dashboard.sections', label: '库存概览', order: 20, viewId: 'inventory_dashboard', dataSource: 'inventory.dashboard_summary', presentation:Object.freeze({groups:Object.freeze([
    Object.freeze({id:'inventory_scale',label:'库存规模',kind:'status',items:Object.freeze([
      Object.freeze({id:'materials',sourceKey:'materials',label:'物料',tone:'neutral',moduleId:'materials'}),Object.freeze({id:'warehouses',sourceKey:'warehouses',label:'仓库',tone:'neutral',moduleId:'warehouses'}),Object.freeze({id:'batches',sourceKey:'batches',label:'库存批次',tone:'teal',moduleId:'inventory_batches'}),Object.freeze({id:'total_quantity',sourceKey:'totalQuantity',label:'库存总量',tone:'teal',moduleId:'inventory_batches'}),Object.freeze({id:'transactions',sourceKey:'transactions',label:'库存流水',tone:'neutral',moduleId:'inventory_transactions'})
    ])}),
    Object.freeze({id:'inventory_attention',label:'需要关注',kind:'attention',items:Object.freeze([
      Object.freeze({id:'warning_batches',sourceKey:'warningBatches',label:'临期批次',tone:'amber',moduleId:'inventory_batches'}),Object.freeze({id:'expired_batches',sourceKey:'expiredBatches',label:'过期批次',tone:'red',moduleId:'inventory_batches'})
    ])})
  ])}) })
]);

export const inventoryUiDescriptor = Object.freeze({
  id: 'inventory_batch',
  version: '1.0.0',
  slots: Object.freeze(['entity.detail.tabs', 'entity.module.actions', 'entity.detail.actions', 'dashboard.sections'] as const),
  extensions
});
