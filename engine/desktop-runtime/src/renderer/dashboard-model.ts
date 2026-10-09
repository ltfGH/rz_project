import type {
  DashboardItemDto,
  DashboardMetricDto,
  DashboardSnapshotDto,
  DashboardTone
} from '../shared/dto';

export type DashboardState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; snapshot: DashboardSnapshotDto }>
  | Readonly<{ status: 'error' }>;

export interface DashboardStatusItemModel extends DashboardItemDto {
  readonly ratio: number;
}

export interface DashboardStatusGroupModel {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionLabel: string;
  readonly label: string;
  readonly items: readonly DashboardStatusItemModel[];
}

export interface DashboardAttentionItemModel extends DashboardItemDto {
  readonly sectionId: string;
  readonly sectionLabel: string;
}

export interface DashboardModel {
  readonly metrics: readonly DashboardMetricDto[];
  readonly statusGroups: readonly DashboardStatusGroupModel[];
  readonly attentionItems: readonly DashboardAttentionItemModel[];
  readonly attentionEmpty: boolean;
}

const severity: Readonly<Record<DashboardTone, number>> = Object.freeze({
  red: 0,
  amber: 1,
  neutral: 2,
  teal: 3
});

export function buildDashboardModel(snapshot: DashboardSnapshotDto): DashboardModel {
  const statusGroups: DashboardStatusGroupModel[] = [];
  const attention: Array<DashboardAttentionItemModel & { readonly descriptorOrder: number }> = [];
  let descriptorOrder = 0;

  for (const section of snapshot.sections) {
    for (const group of section.groups) {
      if (group.kind === 'status') {
        const denominator = Math.max(1, ...group.items.map((item) => item.value));
        statusGroups.push(Object.freeze({
          id: group.id,
          sectionId: section.id,
          sectionLabel: section.label,
          label: group.label,
          items: Object.freeze(group.items.map((item) => Object.freeze({
            ...item,
            ratio: item.value / denominator
          })))
        }));
        continue;
      }
      for (const item of group.items) {
        if (item.value > 0) {
          attention.push(Object.freeze({
            ...item,
            sectionId: section.id,
            sectionLabel: section.label,
            descriptorOrder
          }));
        }
        descriptorOrder += 1;
      }
    }
  }

  attention.sort((left, right) => severity[left.tone] - severity[right.tone] ||
    left.descriptorOrder - right.descriptorOrder);
  const attentionItems = attention.map(({ descriptorOrder: _descriptorOrder, ...item }) => Object.freeze(item));

  return Object.freeze({
    metrics: snapshot.metrics,
    statusGroups: Object.freeze(statusGroups),
    attentionItems: Object.freeze(attentionItems),
    attentionEmpty: attentionItems.length === 0
  });
}
