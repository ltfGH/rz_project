export * from './sla';
export * from './types';
export * from './work-order-service';

export const workOrderRuntimeDescriptor = Object.freeze({
  id: 'work_order_service',
  version: '1.0.0',
  services: Object.freeze(['WorkOrderService'])
});
