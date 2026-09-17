import { issue, sortIssues, type CompositionIssue } from '../shared/errors';
import type { LoadedPack, OwnedKind, PublicExtensionPoint } from '../shared/types';

export interface OwnerRecord {
  readonly packId: string;
  readonly kind: OwnedKind;
  readonly id: string;
}

export interface ExtensionPointRecord extends PublicExtensionPoint {
  readonly packId: string;
}

export interface OwnershipIndex {
  readonly valid: boolean;
  readonly owners: ReadonlyMap<string, OwnerRecord>;
  readonly extensionPoints: ReadonlyMap<string, ExtensionPointRecord>;
  readonly issues: readonly CompositionIssue[];
}

export function ownerKey(kind: OwnedKind, id: string): string {
  return `${kind}:${id}`;
}

export function buildOwnershipIndex(packs: readonly LoadedPack[]): OwnershipIndex {
  const owners = new Map<string, OwnerRecord>();
  const extensionPoints = new Map<string, ExtensionPointRecord>();
  const routes = new Map<string, string>();
  const issues: CompositionIssue[] = [];

  for (const pack of packs) {
    const collections: Array<[OwnedKind, readonly string[]]> = [
      ['entity', pack.fragment.owns.entities],
      ['module', pack.fragment.owns.modules],
      ['workflow', pack.fragment.owns.workflows],
      ['role', pack.fragment.owns.roles]
    ];
    for (const [kind, ids] of collections) {
      ids.forEach((id, index) => {
        const key = ownerKey(kind, id);
        const existing = owners.get(key);
        if (existing) {
          issues.push(issue(
            'OWNERSHIP_CONFLICT', pack.catalog.id, `/owns/${kind}/${index}`,
            `${kind} '${id}' is already owned by '${existing.packId}'.`
          ));
        } else {
          owners.set(key, Object.freeze({ packId: pack.catalog.id, kind, id }));
        }
      });
    }
    const modules = pack.fragment.blueprint.modules as unknown as Array<Record<string, unknown>>;
    modules.forEach((module, index) => {
      if (typeof module.route !== 'string') return;
      const existing = routes.get(module.route);
      if (existing) {
        issues.push(issue(
          'MERGE_CONFLICT', pack.catalog.id, `/blueprint/modules/${index}/route`,
          `Route '${module.route}' is already declared by '${existing}'.`
        ));
      } else routes.set(module.route, pack.catalog.id);
    });
    pack.fragment.publicExtensionPoints.forEach((point, index) => {
      if (extensionPoints.has(point.id)) {
        issues.push(issue(
          'MERGE_CONFLICT', pack.catalog.id, `/publicExtensionPoints/${index}/id`,
          `Extension point '${point.id}' is already declared.`
        ));
      } else {
        extensionPoints.set(point.id, Object.freeze({ ...point, packId: pack.catalog.id }));
      }
    });
  }

  for (const pack of packs) {
    const targetedCollections = [
      ['modules', 'module', pack.fragment.blueprint.modules],
      ['workflows', 'workflow', pack.fragment.blueprint.workflows]
    ] as const;
    for (const [pathName, kind, rawObjects] of targetedCollections) {
      const objects = rawObjects as unknown as Array<Record<string, unknown>>;
      objects.forEach((object, index) => {
        if (typeof object.entity !== 'string') return;
        const entityOwner = owners.get(ownerKey('entity', object.entity));
        if (!entityOwner || entityOwner.packId === pack.catalog.id) return;
        issues.push(issue(
          'OWNERSHIP_CONFLICT',
          pack.catalog.id,
          `/blueprint/${pathName}/${index}/entity`,
          `${kind} '${String(object.id)}' cannot target entity '${object.entity}' owned by '${entityOwner.packId}'.`
        ));
      });
    }
  }
  const sorted = sortIssues(issues);
  return Object.freeze({ valid: sorted.length === 0, owners, extensionPoints, issues: sorted });
}
