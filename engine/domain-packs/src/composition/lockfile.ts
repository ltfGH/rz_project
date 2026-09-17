import type {
  CompositionRequest,
  DomainLock,
  DomainLockPack
} from '../shared/types';
import type { ResolvedPackGraph } from './dependencies';

export function createDomainLock(
  request: CompositionRequest,
  graph: ResolvedPackGraph
): DomainLock {
  const packs: DomainLockPack[] = graph.orderedPacks.map((pack) => Object.freeze({
    id: pack.catalog.id,
    version: pack.catalog.version,
    digest: pack.digest,
    fragmentDigest: pack.fragmentDigest,
    migrationsVersion: pack.catalog.migrationsVersion,
    dependencies: Object.freeze(graph.edges
      .filter((edge) => edge.consumer === pack.catalog.id)
      .map((edge) => edge.provider)
      .sort()),
    uiEntrypointDigest: pack.entrypointDigests.ui
  }));
  return Object.freeze({
    lockVersion: '1.0',
    blueprintSchemaVersion: request.blueprintSchemaVersion,
    runtimeVersion: request.runtimeVersion,
    dependencyOrder: Object.freeze(graph.orderedPacks.map((pack) => pack.catalog.id)),
    packs: Object.freeze(packs)
  });
}
