export type AssetUiSlot = 'entity.detail.tabs' | 'entity.detail.actions';

export interface AssetUiExtension {
  readonly id: string;
  readonly slot: AssetUiSlot;
  readonly entityId: 'asset';
  readonly label: string;
  readonly order: number;
  readonly viewId?: string;
  readonly actionIds?: readonly string[];
}

const extensions: readonly AssetUiExtension[] = Object.freeze([
  Object.freeze({
    id: 'asset.responsibilities.tab',
    slot: 'entity.detail.tabs',
    entityId: 'asset',
    label: '责任关系',
    order: 20,
    viewId: 'asset_responsibility_history'
  }),
  Object.freeze({
    id: 'asset.status_history.tab',
    slot: 'entity.detail.tabs',
    entityId: 'asset',
    label: '状态历史',
    order: 30,
    viewId: 'asset_event_history'
  }),
  Object.freeze({
    id: 'asset.status.actions',
    slot: 'entity.detail.actions',
    entityId: 'asset',
    label: '状态操作',
    order: 10,
    actionIds: Object.freeze([
      'asset.change_status'
    ])
  })
]);

export const assetUiDescriptor = Object.freeze({
  id: 'asset_registry',
  version: '1.0.0',
  slots: Object.freeze(['entity.detail.tabs', 'entity.detail.actions'] as const),
  extensions
});
