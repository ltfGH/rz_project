import type { PackRegistry } from '../catalog/registry';
import { validateComposedBlueprint } from '../blueprint-validator';
import { parseCompositionRequest } from '../protocol/schemas';
import { issue, sortIssues, summarizeIssues, type CompositionIssue } from '../shared/errors';
import type { CompositionRequest, CompositionResult, JsonValue } from '../shared/types';
import { resolveDependencies } from './dependencies';
import { createDomainLock } from './lockfile';
import { mergeFragments } from './merge';
import { buildOwnershipIndex } from './ownership';

function blocked(
  issues: readonly CompositionIssue[],
  report: Readonly<Record<string, JsonValue>> = {}
): CompositionResult {
  const sorted = sortIssues(issues);
  return Object.freeze({
    valid: false,
    canGenerate: false,
    report: Object.freeze(report),
    issues: sorted,
    summary: summarizeIssues(sorted)
  });
}

function compatibilityIssues(request: CompositionRequest, packs: ReturnType<typeof resolveDependencies>['orderedPacks']): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  for (const pack of packs) {
    if (!pack.catalog.blueprintSchemaVersions.includes(request.blueprintSchemaVersion)) {
      issues.push(issue(
        'PACK_VERSION_INCOMPATIBLE', pack.catalog.id, '/blueprintSchemaVersions',
        `Pack does not support blueprint schema '${request.blueprintSchemaVersion}'.`
      ));
    }
    if (!pack.catalog.runtimeVersions.includes(request.runtimeVersion)) {
      issues.push(issue(
        'PACK_VERSION_INCOMPATIBLE', pack.catalog.id, '/runtimeVersions',
        `Pack does not support runtime '${request.runtimeVersion}'.`
      ));
    }
  }
  return issues;
}

export function composeDomainPacks(
  rawRequest: unknown,
  registry: PackRegistry
): CompositionResult {
  let request: CompositionRequest;
  try {
    request = parseCompositionRequest(rawRequest);
  } catch (error) {
    return blocked([issue(
      'PACK_CATALOG_INVALID', 'composition', '/',
      error instanceof Error ? error.message : String(error)
    )]);
  }
  const graph = resolveDependencies(request.selections, registry);
  if (!graph.valid) return blocked(graph.issues, { stage: 'dependencies' });
  const compatible = compatibilityIssues(request, graph.orderedPacks);
  if (compatible.length > 0) return blocked(compatible, { stage: 'compatibility' });
  const ownership = buildOwnershipIndex(graph.orderedPacks);
  if (!ownership.valid) return blocked(ownership.issues, { stage: 'ownership' });
  const merged = mergeFragments(graph.orderedPacks, ownership);
  if (!merged.valid) return blocked(merged.issues, { stage: 'merge' });

  const entityMinimums = Object.fromEntries(Object.entries(merged.seed.records).map(
    ([entityId, records]) => [entityId, records.length]
  ));
  const blueprint = Object.freeze({
    schemaVersion: request.blueprintSchemaVersion,
    software: request.software,
    archetypes: Object.freeze(graph.orderedPacks.map((pack) => pack.catalog.id)),
    capabilities: Object.freeze([
      'attachments', 'audit', 'entity_crud', 'relationships', 'transactions', 'workflow'
    ]),
    coverage: request.coverage,
    plugins: Object.freeze(graph.orderedPacks.map((pack) => {
      const selection = request.selections.find((item) => item.id === pack.catalog.id)!;
      return Object.freeze({ id: pack.catalog.id, config: selection.config });
    })),
    modules: merged.blueprint.modules,
    entities: merged.blueprint.entities,
    roles: merged.blueprint.roles,
    workflows: merged.blueprint.workflows,
    dashboards: merged.blueprint.dashboards,
    demoData: Object.freeze({ seed: 20260917, entityMinimums: Object.freeze(entityMinimums) }),
    materials: request.materials
  });
  const validation = validateComposedBlueprint(blueprint);
  const validationIssues = validation.issues.map((entry) => issue(
    entry.code === 'UNSUPPORTED_REQUIREMENT' ? 'UNSUPPORTED_REQUIREMENT' : 'COMPOSED_BLUEPRINT_INVALID',
    'composition',
    entry.path,
    `[${entry.code}] ${entry.message}`,
    entry.severity === 'warning' || entry.severity === 'info' ? entry.severity : 'error'
  ));
  const report = Object.freeze({
    stage: 'validated',
    dependencyOrder: graph.orderedPacks.map((pack) => pack.catalog.id),
    ownership: Object.freeze(Object.fromEntries(
      merged.blueprint.entities.map((entity) => [String(entity.id), ownership.owners.get(`entity:${String(entity.id)}`)?.packId ?? 'unknown'])
    )),
    seed: merged.seed
  }) as unknown as Readonly<Record<string, JsonValue>>;
  if (!validation.canGenerate) {
    const sorted = sortIssues(validationIssues);
    return Object.freeze({
      valid: validation.valid,
      canGenerate: false,
      report,
      issues: sorted,
      summary: summarizeIssues(sorted)
    });
  }
  const lock = createDomainLock(request, graph);
  return Object.freeze({
    valid: true,
    canGenerate: true,
    blueprint: blueprint as unknown as Readonly<Record<string, JsonValue>>,
    lock,
    report,
    issues: Object.freeze([]),
    summary: ''
  });
}
