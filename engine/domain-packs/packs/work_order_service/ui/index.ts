export type WorkOrderUiSlot =
  | 'entity.detail.tabs'
  | 'entity.detail.actions'
  | 'dashboard.sections';

export interface WorkOrderUiExtension {
  readonly id: string;
  readonly slot: WorkOrderUiSlot;
  readonly label: string;
  readonly order: number;
  readonly entityId?: 'work_order' | 'sla_policy';
  readonly viewId?: string;
  readonly dataSource?: string;
  readonly actionIds?: readonly string[];
}

const extensions: readonly WorkOrderUiExtension[] = Object.freeze([
  Object.freeze({
    id: 'work_order.processing.tab', slot: 'entity.detail.tabs', entityId: 'work_order',
    label: '处理记录', order: 20, viewId: 'work_order_processing_history'
  }),
  Object.freeze({
    id: 'work_order.history.tab', slot: 'entity.detail.tabs', entityId: 'work_order',
    label: '流转历史', order: 30, viewId: 'work_order_event_history'
  }),
  Object.freeze({
    id: 'work_order.sla.tab', slot: 'entity.detail.tabs', entityId: 'work_order',
    label: 'SLA状态', order: 40, viewId: 'work_order_sla_status'
  }),
  Object.freeze({
    id: 'work_order.lifecycle.actions', slot: 'entity.detail.actions', entityId: 'work_order',
    label: '工单操作', order: 10,
    actionIds: Object.freeze([
      'work_order.dispatch', 'work_order.accept', 'work_order.add_processing_record',
      'work_order.submit_resolution', 'work_order.reject_review', 'work_order.approve_close'
    ])
  }),
  Object.freeze({
    id: 'work_order.sla.dashboard', slot: 'dashboard.sections',
    label: 'SLA状态', order: 20, viewId: 'work_order_sla_dashboard',
    dataSource: 'work_order.dashboard_summary'
  }),
  Object.freeze({
    id: 'sla_policy.manage.actions', slot: 'entity.detail.actions', entityId: 'sla_policy',
    label: 'SLA策略操作', order: 10,
    actionIds: Object.freeze(['sla_policy.create', 'sla_policy.update'])
  })
]);

export const workOrderUiDescriptor = Object.freeze({
  id: 'work_order_service',
  version: '1.0.0',
  slots: Object.freeze([
    'entity.detail.tabs', 'entity.detail.actions', 'dashboard.sections'
  ] as const),
  extensions
});
