export const assetWorkOrderUiDescriptor = Object.freeze({
  id: 'asset_work_order_bridge',
  version: '1.0.0',
  extensions: Object.freeze([
    Object.freeze({
      id: 'asset.work_orders.tab',
      slot: 'entity.detail.tabs',
      entityId: 'asset',
      label: '关联工单',
      order: 40,
      viewId: 'asset_work_order_history'
    }),
    Object.freeze({
      id: 'asset.create_work_order.action',
      slot: 'entity.detail.actions',
      entityId: 'asset',
      label: '创建工单',
      order: 40,
      actionIds: Object.freeze(['asset.work_order.create'])
    }),
    Object.freeze({
      id: 'work_order.asset.tab',
      slot: 'entity.detail.tabs',
      entityId: 'work_order',
      label: '关联资产',
      order: 50,
      viewId: 'work_order_asset_context'
    })
  ])
});
