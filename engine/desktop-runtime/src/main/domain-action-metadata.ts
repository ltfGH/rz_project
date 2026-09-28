import type { DomainActionDto } from '../shared/dto';

interface Contribution { readonly value: unknown }
interface UiActionExtension {
  readonly slot?: string;
  readonly entityId?: string;
  readonly label?: string;
  readonly order?: number;
  readonly actionIds?: readonly string[];
}

export function collectDomainActionMetadata(
  uiExtensions: Readonly<Record<string, Contribution>>,
  domainActions: Readonly<Record<string, Contribution>>,
  allows: (permission: string) => boolean
): readonly DomainActionDto[] {
  const result: DomainActionDto[] = [];
  for (const entry of Object.values(uiExtensions)) {
    const extension = entry.value as UiActionExtension;
    const scope = extension.slot === 'entity.module.actions' ? 'module'
      : extension.slot === 'entity.detail.actions' ? 'record' : undefined;
    if (!scope || !extension.entityId) continue;
    for (const id of extension.actionIds ?? []) {
      const action = domainActions[id]?.value as { permission?: string } | undefined;
      if (!action?.permission || !allows(action.permission)) continue;
      result.push(Object.freeze({
        id, entityId: extension.entityId, label: extension.label ?? id,
        order: extension.order ?? 100, scope
      }));
    }
  }
  return Object.freeze(result);
}
