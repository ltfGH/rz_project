import { canonicalJson } from '../shared/canonical-json';
import { issue, sortIssues, type CompositionIssue } from '../shared/errors';
import type { JsonValue, LoadedPack, OwnedKind } from '../shared/types';
import { ownerKey, type OwnershipIndex } from './ownership';

type BlueprintObject = Record<string, any>;

export interface MergedBlueprintParts {
  readonly valid: boolean;
  readonly blueprint: Readonly<{
    entities: readonly BlueprintObject[];
    modules: readonly BlueprintObject[];
    workflows: readonly BlueprintObject[];
    roles: readonly BlueprintObject[];
    dashboards: readonly BlueprintObject[];
  }>;
  readonly seed: Readonly<{ records: Readonly<Record<string, readonly BlueprintObject[]>> }>;
  readonly issues: readonly CompositionIssue[];
}

const emptyBlueprint = () => Object.freeze({
  entities: Object.freeze([]), modules: Object.freeze([]), workflows: Object.freeze([]),
  roles: Object.freeze([]), dashboards: Object.freeze([])
});

function pointerTarget(root: unknown, pointer: string): unknown {
  if (pointer === '/') return root;
  const parts = pointer.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: any = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function recordKey(record: BlueprintObject): string {
  if (typeof record.code === 'string') return `code:${record.code}`;
  if (typeof record.id === 'string' || typeof record.id === 'number') return `id:${record.id}`;
  return `json:${canonicalJson(record)}`;
}

export function mergeFragments(
  packs: readonly LoadedPack[],
  ownership: OwnershipIndex
): MergedBlueprintParts {
  const issues: CompositionIssue[] = [...ownership.issues];
  const blueprint = {
    entities: [] as BlueprintObject[],
    modules: [] as BlueprintObject[],
    workflows: [] as BlueprintObject[],
    roles: [] as BlueprintObject[],
    dashboards: [] as BlueprintObject[]
  };
  const objects = new Map<string, BlueprintObject>();
  const seeds = new Map<string, BlueprintObject[]>();
  const seedKeys = new Map<string, Set<string>>();

  for (const pack of packs) {
    for (const section of ['entities', 'modules', 'workflows', 'roles', 'dashboards'] as const) {
      const target = blueprint[section];
      for (const source of pack.fragment.blueprint[section] as unknown as BlueprintObject[]) {
        const clone = structuredClone(source);
        target.push(clone);
        if (section !== 'dashboards') {
          const kind = ({
            entities: 'entity', modules: 'module', workflows: 'workflow', roles: 'role'
          } as const)[section];
          objects.set(ownerKey(kind, String(clone.id)), clone);
        }
      }
    }
    for (const [entityId, records] of Object.entries(pack.fragment.seed.records)) {
      const target = seeds.get(entityId) ?? [];
      const keys = seedKeys.get(entityId) ?? new Set<string>();
      records.forEach((record, index) => {
        const clone = structuredClone(record) as BlueprintObject;
        const key = recordKey(clone);
        if (keys.has(key)) {
          issues.push(issue(
            'SEED_CONFLICT', pack.catalog.id, `/seed/records/${entityId}/${index}`,
            `Seed record '${key}' is duplicated for entity '${entityId}'.`
          ));
        } else {
          keys.add(key); target.push(clone);
        }
      });
      seeds.set(entityId, target); seedKeys.set(entityId, keys);
    }
  }

  for (const pack of packs) {
    pack.fragment.extensions.forEach((extension, index) => {
      const point = ownership.extensionPoints.get(extension.point);
      const extensionPath = `/extensions/${index}`;
      if (!point) {
        issues.push(issue(
          'EXTENSION_POINT_UNKNOWN', pack.catalog.id, `${extensionPath}/point`,
          `Extension point '${extension.point}' is not public.`
        ));
        return;
      }
      if (point.packId === pack.catalog.id) {
        issues.push(issue(
          'MERGE_CONFLICT', pack.catalog.id, extensionPath,
          `Pack '${pack.catalog.id}' must modify its own objects directly.`
        ));
        return;
      }
      if (!point.allowedOperations.includes(extension.operation)) {
        issues.push(issue(
          'MERGE_CONFLICT', pack.catalog.id, `${extensionPath}/operation`,
          `Operation '${extension.operation}' is not allowed by '${extension.point}'.`
        ));
        return;
      }
      const target = objects.get(ownerKey(point.targetKind, point.targetId));
      if (!target) {
        issues.push(issue(
          'EXTENSION_POINT_UNKNOWN', pack.catalog.id, `${extensionPath}/point`,
          `Extension target '${point.targetKind}:${point.targetId}' does not exist.`
        ));
        return;
      }
      const location = pointerTarget(target, extension.path);
      if (extension.operation === 'merge_display') {
        if (!location || typeof location !== 'object' || Array.isArray(location) ||
            !extension.value || typeof extension.value !== 'object' || Array.isArray(extension.value)) {
          issues.push(issue('MERGE_CONFLICT', pack.catalog.id, extensionPath, 'Display merge target and value must be objects.'));
          return;
        }
        const allowed = new Set(['name', 'description', 'order']);
        const entries = Object.entries(extension.value);
        if (entries.some(([key]) => !allowed.has(key))) {
          issues.push(issue('MERGE_CONFLICT', pack.catalog.id, extensionPath, 'Display merge can change only name, description and order.'));
          return;
        }
        Object.assign(location, structuredClone(extension.value));
        return;
      }
      if (!Array.isArray(location)) {
        issues.push(issue('MERGE_CONFLICT', pack.catalog.id, extensionPath, 'Extension target must be an array.'));
        return;
      }
      const incoming = extension.operation === 'extend_enum'
        ? (Array.isArray(extension.value) ? extension.value : [])
        : [extension.value];
      if (incoming.length === 0) {
        issues.push(issue('MERGE_CONFLICT', pack.catalog.id, extensionPath, 'Extension value is empty or invalid.'));
        return;
      }
      for (const value of incoming) {
        const id = value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, JsonValue>).id
          : value;
        const duplicate = location.some((existing) => {
          const existingId = existing && typeof existing === 'object' && !Array.isArray(existing)
            ? existing.id
            : existing;
          return existingId === id;
        });
        if (duplicate) {
          issues.push(issue('MERGE_CONFLICT', pack.catalog.id, extensionPath, `Extension value '${String(id)}' already exists.`));
        } else location.push(structuredClone(value));
      }
    });
  }

  const sorted = sortIssues(issues);
  if (sorted.length > 0) {
    return Object.freeze({
      valid: false,
      blueprint: emptyBlueprint(),
      seed: Object.freeze({ records: Object.freeze({}) }),
      issues: sorted
    });
  }
  const frozenBlueprint = Object.freeze({
    entities: Object.freeze(blueprint.entities), modules: Object.freeze(blueprint.modules),
    workflows: Object.freeze(blueprint.workflows), roles: Object.freeze(blueprint.roles),
    dashboards: Object.freeze(blueprint.dashboards)
  });
  const seedRecords = Object.freeze(Object.fromEntries(
    [...seeds.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([id, records]) => [id, Object.freeze(records)])
  ));
  return Object.freeze({
    valid: true,
    blueprint: frozenBlueprint,
    seed: Object.freeze({ records: seedRecords }),
    issues: sorted
  });
}
