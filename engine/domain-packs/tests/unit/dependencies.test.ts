import test from 'node:test';
import assert from 'node:assert/strict';

import { PackRegistry } from '../../src/catalog/registry';
import { resolveDependencies } from '../../src/composition/dependencies';
import type { LoadedPack, PackSelection } from '../../src/shared/types';

function pack(
  id: string,
  provides: string[],
  requires: string[] = [],
  allowedDependencies: string[] = [],
  version = '1.0.0'
): LoadedPack {
  return {
    root: `C:\\packs\\${id}`,
    digest: `${id}-digest`,
    fragmentDigest: `${id}-fragment`,
    catalog: {
      catalogVersion: '1.0', id, version, name: id, description: id,
      blueprintSchemaVersions: ['1.0'], runtimeVersions: ['1.0.0'],
      provides, requires, allowedDependencies, migrationsVersion: 1,
      entrypoints: {
        fragment: 'blueprint.json', runtime: 'runtime/index.js', ui: 'ui/index.js',
        seed: 'seed/index.json', tests: 'tests/index.js'
      },
      uiSlots: []
    },
    fragment: {
      fragmentVersion: '1.0', pack: { id, version },
      owns: { entities: [], modules: [], workflows: [], roles: [] },
      publicExtensionPoints: [], extensions: [],
      blueprint: { entities: [], modules: [], workflows: [], roles: [], dashboards: [] },
      seed: { records: {} }
    }
  };
}

function selection(id: string, version = '1.0.0'): PackSelection {
  return { id, version, config: {} };
}

function registry(...packs: LoadedPack[]): PackRegistry {
  const value = new PackRegistry();
  packs.forEach((item) => value.register(item));
  return value;
}

test('resolves unique providers in stable topological order', () => {
  const asset = pack('asset_registry', ['asset.core']);
  const work = pack('work_order_service', ['work.core'], ['asset.core'], ['asset_registry']);
  const inspection = pack(
    'inspection_rectification', ['inspection.core'], ['asset.core', 'work.core'],
    ['asset_registry', 'work_order_service']
  );
  const source = registry(asset, work, inspection);

  const forward = resolveDependencies([
    selection('inspection_rectification'), selection('asset_registry'), selection('work_order_service')
  ], source);
  const reverse = resolveDependencies([
    selection('work_order_service'), selection('inspection_rectification'), selection('asset_registry')
  ], source);

  assert.equal(forward.valid, true);
  assert.deepEqual(forward.orderedPacks.map((item) => item.catalog.id), [
    'asset_registry', 'work_order_service', 'inspection_rectification'
  ]);
  assert.deepEqual(reverse.orderedPacks.map((item) => item.catalog.id), forward.orderedPacks.map((item) => item.catalog.id));
  assert.deepEqual(forward.capabilityProviders, {
    'asset.core': 'asset_registry', 'inspection.core': 'inspection_rectification', 'work.core': 'work_order_service'
  });
});

test('reports missing and ambiguous capability providers', () => {
  const consumer = pack('consumer_pack', ['consumer.core'], ['asset.core'], ['asset_registry']);
  const missing = resolveDependencies([selection('consumer_pack')], registry(consumer));
  assert.deepEqual(missing.issues.map((item) => item.code), ['CAPABILITY_MISSING']);

  const first = pack('asset_registry', ['asset.core']);
  const second = pack('alternate_asset', ['asset.core']);
  const ambiguous = resolveDependencies(
    [selection('consumer_pack'), selection('asset_registry'), selection('alternate_asset')],
    registry(consumer, first, second)
  );
  assert.ok(ambiguous.issues.some((item) => item.code === 'CAPABILITY_AMBIGUOUS'));
});

test('rejects dependencies not declared in allowedDependencies', () => {
  const asset = pack('asset_registry', ['asset.core']);
  const consumer = pack('consumer_pack', ['consumer.core'], ['asset.core'], []);
  const result = resolveDependencies(
    [selection('consumer_pack'), selection('asset_registry')], registry(asset, consumer)
  );

  assert.ok(result.issues.some((item) => item.code === 'DEPENDENCY_NOT_ALLOWED'));
});

test('distinguishes missing packs from exact version incompatibility', () => {
  const source = registry(pack('asset_registry', ['asset.core'], [], [], '1.0.0'));
  assert.ok(resolveDependencies([selection('missing_pack')], source).issues.some((item) => item.code === 'PACK_NOT_FOUND'));
  assert.ok(resolveDependencies([selection('asset_registry', '2.0.0')], source).issues.some((item) => item.code === 'PACK_VERSION_INCOMPATIBLE'));
});

test('detects self and multi-node dependency cycles', () => {
  const self = pack('self_pack', ['self.core'], ['self.core'], ['self_pack']);
  assert.ok(resolveDependencies([selection('self_pack')], registry(self)).issues.some((item) => item.code === 'DEPENDENCY_CYCLE'));

  const first = pack('first_pack', ['first.core'], ['third.core'], ['third_pack']);
  const second = pack('second_pack', ['second.core'], ['first.core'], ['first_pack']);
  const third = pack('third_pack', ['third.core'], ['second.core'], ['second_pack']);
  const result = resolveDependencies(
    [selection('third_pack'), selection('first_pack'), selection('second_pack')],
    registry(first, second, third)
  );
  const cycle = result.issues.find((item) => item.code === 'DEPENDENCY_CYCLE');
  assert.ok(cycle);
  assert.match(cycle.message, /first_pack.*third_pack.*second_pack.*first_pack/);
});
