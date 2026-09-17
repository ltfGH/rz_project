export const workOrderUiDescriptor = Object.freeze({
  id: 'work_order_service',
  version: '1.0.0',
  slots: Object.freeze([
    'entity.detail.tabs', 'entity.detail.actions', 'dashboard.sections'
  ] as const),
  extensions: Object.freeze([] as readonly unknown[])
});
