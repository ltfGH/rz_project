import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOwnershipIndex } from '../../src/composition/ownership';
import { mergeFragments } from '../../src/composition/merge';
import type { FragmentExtension, LoadedPack, PackFragment } from '../../src/shared/types';

function loaded(
  id: string,
  fragment: Partial<PackFragment> & Pick<PackFragment, 'owns' | 'blueprint'>,
  extensions: readonly FragmentExtension[] = []
): LoadedPack {
  return {
    root: `C:\\packs\\${id}`,
    digest: `${id}-digest`,
    fragmentDigest: `${id}-fragment`,
    entrypointDigests: {
      fragment: '1'.repeat(64), runtime: '2'.repeat(64), ui: '3'.repeat(64),
      seed: '4'.repeat(64), tests: '5'.repeat(64)
    },
    catalog: {
      catalogVersion: '1.0', id, version: '1.0.0', name: id, description: id,
      blueprintSchemaVersions: ['1.0'], runtimeVersions: ['1.0.0'],
      provides: [`${id}.core`], requires: [], allowedDependencies: [],
      migrationsVersion: 1,
      entrypoints: {
        fragment: 'blueprint.json', runtime: 'runtime/index.js', ui: 'ui/index.js',
        seed: 'seed/index.json', tests: 'tests/index.js'
      },
      uiSlots: []
    },
    fragment: {
      fragmentVersion: '1.0', pack: { id, version: '1.0.0' },
      publicExtensionPoints: fragment.publicExtensionPoints ?? [],
      extensions,
      seed: fragment.seed ?? { records: {} },
      owns: fragment.owns,
      blueprint: fragment.blueprint
    }
  };
}

function provider(): LoadedPack {
  return loaded('asset_registry', {
    owns: { entities: ['asset'], modules: ['assets'], workflows: ['asset_flow'], roles: [] },
    publicExtensionPoints: [
      { id: 'asset.detail.tabs', targetKind: 'entity', targetId: 'asset', allowedOperations: ['append'] },
      { id: 'asset.display', targetKind: 'entity', targetId: 'asset', allowedOperations: ['merge_display'] },
      { id: 'asset.status.options', targetKind: 'entity', targetId: 'asset', allowedOperations: ['extend_enum'] },
      { id: 'asset.flow.transitions', targetKind: 'workflow', targetId: 'asset_flow', allowedOperations: ['add_transition'] }
    ],
    blueprint: {
      entities: [{
        id: 'asset', name: '资产', description: '资产台账', order: 1,
        detailTabs: [],
        fields: [{ id: 'status', type: 'enum', required: true, unique: false, options: ['active'] }]
      }],
      modules: [{ id: 'assets', name: '资产台账', route: 'assets' }],
      workflows: [{
        id: 'asset_flow', states: ['active', 'inactive'],
        transitions: [{ id: 'deactivate', from: 'active', to: 'inactive' }]
      }],
      roles: [], dashboards: []
    },
    seed: { records: { asset: [{ code: 'AST-001' }] } }
  });
}

test('rejects duplicate owners and routes', () => {
  const first = provider();
  const duplicateOwner = loaded('duplicate_pack', {
    owns: { entities: ['asset'], modules: [], workflows: [], roles: [] },
    blueprint: { entities: [{ id: 'asset' }], modules: [], workflows: [], roles: [], dashboards: [] }
  });
  assert.ok(buildOwnershipIndex([first, duplicateOwner]).issues.some((item) => item.code === 'OWNERSHIP_CONFLICT'));

  const duplicateRoute = loaded('route_pack', {
    owns: { entities: [], modules: ['other_assets'], workflows: [], roles: [] },
    blueprint: {
      entities: [], modules: [{ id: 'other_assets', route: 'assets' }],
      workflows: [], roles: [], dashboards: []
    }
  });
  assert.ok(buildOwnershipIndex([first, duplicateRoute]).issues.some((item) => item.code === 'MERGE_CONFLICT'));
});

test('rejects foreign modules and workflows that target another pack entity', () => {
  const base = provider();
  const bypass = loaded('asset_bypass', {
    owns: {
      entities: [], modules: ['asset_editor'], workflows: ['asset_override'], roles: []
    },
    blueprint: {
      entities: [],
      modules: [{ id: 'asset_editor', route: 'asset_editor', entity: 'asset', actions: ['update'] }],
      workflows: [{
        id: 'asset_override', entity: 'asset', states: ['active', 'inactive'],
        transitions: [{ id: 'force_inactive', from: 'active', to: 'inactive' }]
      }],
      roles: [],
      dashboards: []
    }
  });

  const result = buildOwnershipIndex([base, bypass]);
  assert.equal(result.valid, false);
  assert.equal(
    result.issues.filter((item) => item.code === 'OWNERSHIP_CONFLICT').length,
    2
  );
});

test('rejects missing, private and self extension points', () => {
  const base = provider();
  const missing = loaded('missing_extension', {
    owns: { entities: [], modules: [], workflows: [], roles: [] },
    blueprint: { entities: [], modules: [], workflows: [], roles: [], dashboards: [] }
  }, [{ point: 'asset.private', operation: 'append', path: '/detailTabs', value: { id: 'x' } }]);
  assert.ok(mergeFragments([base, missing], buildOwnershipIndex([base, missing])).issues.some(
    (item) => item.code === 'EXTENSION_POINT_UNKNOWN'
  ));

  const self = loaded('self_pack', {
    owns: { entities: ['self_entity'], modules: [], workflows: [], roles: [] },
    publicExtensionPoints: [{
      id: 'self.tabs', targetKind: 'entity', targetId: 'self_entity', allowedOperations: ['append']
    }],
    blueprint: {
      entities: [{ id: 'self_entity', tabs: [] }], modules: [], workflows: [], roles: [], dashboards: []
    }
  }, [{ point: 'self.tabs', operation: 'append', path: '/tabs', value: { id: 'x' } }]);
  assert.ok(mergeFragments([self], buildOwnershipIndex([self])).issues.some(
    (item) => item.code === 'MERGE_CONFLICT'
  ));
});

test('applies all declared extension operations without mutating source packs', () => {
  const base = provider();
  const before = JSON.stringify(base.fragment);
  const consumer = loaded('inspection_rectification', {
    owns: { entities: [], modules: ['inspections'], workflows: [], roles: [] },
    blueprint: {
      entities: [], modules: [{ id: 'inspections', route: 'inspections' }],
      workflows: [], roles: [], dashboards: []
    }
  }, [
    { point: 'asset.detail.tabs', operation: 'append', path: '/detailTabs', value: { id: 'inspection_history' } },
    { point: 'asset.display', operation: 'merge_display', path: '/', value: { name: '设备资产', order: 2 } },
    { point: 'asset.status.options', operation: 'extend_enum', path: '/fields/0/options', value: ['maintenance'] },
    { point: 'asset.flow.transitions', operation: 'add_transition', path: '/transitions', value: { id: 'maintain', from: 'active', to: 'inactive' } }
  ]);

  const result = mergeFragments([base, consumer], buildOwnershipIndex([base, consumer]));
  const asset = result.blueprint.entities.find((item: any) => item.id === 'asset') as any;
  const flow = result.blueprint.workflows.find((item: any) => item.id === 'asset_flow') as any;
  assert.deepEqual(result.issues, []);
  assert.deepEqual(asset.detailTabs, [{ id: 'inspection_history' }]);
  assert.equal(asset.name, '设备资产');
  assert.equal(asset.order, 2);
  assert.deepEqual(asset.fields[0].options, ['active', 'maintenance']);
  assert.deepEqual(flow.transitions.map((item: any) => item.id), ['deactivate', 'maintain']);
  assert.equal(JSON.stringify(base.fragment), before);
});

test('rejects incompatible display, enum, transition and seed merges', () => {
  const base = provider();
  const conflict = loaded('conflict_pack', {
    owns: { entities: [], modules: [], workflows: [], roles: [] },
    blueprint: { entities: [], modules: [], workflows: [], roles: [], dashboards: [] },
    seed: { records: { asset: [{ code: 'AST-001' }] } }
  }, [
    { point: 'asset.display', operation: 'merge_display', path: '/', value: { required: false } },
    { point: 'asset.status.options', operation: 'extend_enum', path: '/fields/0/options', value: ['active'] },
    { point: 'asset.flow.transitions', operation: 'add_transition', path: '/transitions', value: { id: 'deactivate' } }
  ]);

  const result = mergeFragments([base, conflict], buildOwnershipIndex([base, conflict]));
  assert.ok(result.issues.some((item) => item.code === 'MERGE_CONFLICT'));
  assert.ok(result.issues.some((item) => item.code === 'SEED_CONFLICT'));
  assert.equal(result.valid, false);
});
