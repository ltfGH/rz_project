import type { PackRegistry } from '../catalog/registry';
import { issue, sortIssues, type CompositionIssue } from '../shared/errors';
import type { LoadedPack, PackSelection } from '../shared/types';

export interface ResolvedPackGraph {
  readonly valid: boolean;
  readonly orderedPacks: readonly LoadedPack[];
  readonly capabilityProviders: Readonly<Record<string, string>>;
  readonly edges: readonly Readonly<{ provider: string; consumer: string; capability: string }>[];
  readonly issues: readonly CompositionIssue[];
}

function stableCycle(dependencies: ReadonlyMap<string, readonly string[]>): readonly string[] | undefined {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const walk = (id: string): readonly string[] | undefined => {
    if (active.has(id)) {
      const index = stack.indexOf(id);
      return [...stack.slice(index), id];
    }
    if (visited.has(id)) return undefined;
    visited.add(id); active.add(id); stack.push(id);
    for (const dependency of [...(dependencies.get(id) ?? [])].sort()) {
      const found = walk(dependency);
      if (found) return found;
    }
    stack.pop(); active.delete(id);
    return undefined;
  };
  for (const id of [...dependencies.keys()].sort()) {
    const found = walk(id);
    if (found) return found;
  }
  return undefined;
}

export function resolveDependencies(
  selections: readonly PackSelection[],
  registry: PackRegistry
): ResolvedPackGraph {
  const issues: CompositionIssue[] = [];
  const selected = new Map<string, LoadedPack>();
  for (const selection of [...selections].sort((left, right) => left.id.localeCompare(right.id))) {
    if (selected.has(selection.id)) {
      issues.push(issue(
        'PACK_CATALOG_INVALID', selection.id, '/selections',
        `Pack '${selection.id}' is selected more than once.`
      ));
      continue;
    }
    try {
      selected.set(selection.id, registry.get(selection.id, selection.version));
    } catch {
      const versions = registry.versions(selection.id);
      issues.push(issue(
        versions.length > 0 ? 'PACK_VERSION_INCOMPATIBLE' : 'PACK_NOT_FOUND',
        selection.id,
        '/selections',
        versions.length > 0
          ? `Pack '${selection.id}' does not provide exact version '${selection.version}'.`
          : `Pack '${selection.id}' is not registered.`
      ));
    }
  }

  const providers = new Map<string, string[]>();
  for (const pack of selected.values()) {
    for (const capability of pack.catalog.provides) {
      const values = providers.get(capability) ?? [];
      values.push(pack.catalog.id);
      providers.set(capability, values);
    }
  }
  for (const values of providers.values()) values.sort();

  const dependencyMap = new Map<string, string[]>();
  const edges: Array<{ provider: string; consumer: string; capability: string }> = [];
  for (const pack of [...selected.values()].sort((left, right) => left.catalog.id.localeCompare(right.catalog.id))) {
    dependencyMap.set(pack.catalog.id, []);
    pack.catalog.requires.forEach((capability, index) => {
      const matches = providers.get(capability) ?? [];
      if (matches.length === 0) {
        issues.push(issue(
          'CAPABILITY_MISSING', pack.catalog.id, `/requires/${index}`,
          `Required capability '${capability}' has no selected provider.`
        ));
        return;
      }
      if (matches.length > 1) {
        issues.push(issue(
          'CAPABILITY_AMBIGUOUS', pack.catalog.id, `/requires/${index}`,
          `Required capability '${capability}' has multiple providers: ${matches.join(', ')}.`
        ));
        return;
      }
      const provider = matches[0]!;
      if (!pack.catalog.allowedDependencies.includes(provider)) {
        issues.push(issue(
          'DEPENDENCY_NOT_ALLOWED', pack.catalog.id, `/requires/${index}`,
          `Dependency '${provider}' is not allowed by pack '${pack.catalog.id}'.`
        ));
      }
      dependencyMap.get(pack.catalog.id)!.push(provider);
      edges.push({ provider, consumer: pack.catalog.id, capability });
    });
  }

  const cycle = stableCycle(dependencyMap);
  if (cycle) {
    issues.push(issue(
      'DEPENDENCY_CYCLE', cycle[0]!, '/requires',
      `Dependency cycle detected: ${cycle.join(' -> ')}.`
    ));
  }

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of selected.keys()) { adjacency.set(id, []); indegree.set(id, 0); }
  for (const edge of edges) {
    if (edge.provider === edge.consumer) continue;
    adjacency.get(edge.provider)?.push(edge.consumer);
    indegree.set(edge.consumer, (indegree.get(edge.consumer) ?? 0) + 1);
  }
  for (const values of adjacency.values()) values.sort();
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const ordered: LoadedPack[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(selected.get(id)!);
    for (const consumer of adjacency.get(id) ?? []) {
      const next = (indegree.get(consumer) ?? 0) - 1;
      indegree.set(consumer, next);
      if (next === 0) {
        ready.push(consumer);
        ready.sort();
      }
    }
  }

  const capabilityProviders = Object.freeze(Object.fromEntries(
    [...providers.entries()]
      .filter(([, values]) => values.length === 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([capability, values]) => [capability, values[0]!])
  ));
  const sortedIssues = sortIssues(issues);
  return Object.freeze({
    valid: sortedIssues.length === 0 && ordered.length === selected.size,
    orderedPacks: Object.freeze(sortedIssues.length === 0 ? ordered : []),
    capabilityProviders,
    edges: Object.freeze(edges
      .sort((left, right) => (
        left.provider.localeCompare(right.provider) ||
        left.consumer.localeCompare(right.consumer) ||
        left.capability.localeCompare(right.capability)
      ))
      .map((edge) => Object.freeze(edge))),
    issues: sortedIssues
  });
}
