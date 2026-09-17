import test from 'node:test';
import assert from 'node:assert/strict';

import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import { canonicalJson } from '../../src/shared/canonical-json';
import type { CompositionRequest, LoadedPack, PackFragment } from '../../src/shared/types';

function loaded(
  id: string,
  provides: string[],
  fragment: PackFragment,
  requires: string[] = [],
  allowedDependencies: string[] = []
): LoadedPack {
  return {
    root: `C:\\packs\\${id}`,
    digest: `${id.padEnd(64, '0').slice(0, 64)}`,
    fragmentDigest: `${id.padEnd(64, '1').slice(0, 64)}`,
    entrypointDigests: {
      fragment: '1'.repeat(64), runtime: '2'.repeat(64), ui: '3'.repeat(64),
      seed: '4'.repeat(64), tests: '5'.repeat(64)
    },
    catalog: {
      catalogVersion: '1.0', id, version: '1.0.0', name: id, description: id,
      blueprintSchemaVersions: ['1.0'], runtimeVersions: ['1.0.0'],
      provides, requires, allowedDependencies, migrationsVersion: 1,
      entrypoints: {
        fragment: 'blueprint.json', runtime: 'runtime/index.js', ui: 'ui/index.js',
        seed: 'seed/index.json', tests: 'tests/index.js'
      },
      uiSlots: []
    },
    fragment
  };
}

function assetPack(): LoadedPack {
  return loaded('asset_registry', ['asset.core'], {
    fragmentVersion: '1.0', pack: { id: 'asset_registry', version: '1.0.0' },
    owns: { entities: ['asset'], modules: ['assets'], workflows: [], roles: [] },
    publicExtensionPoints: [{
      id: 'asset.fields', targetKind: 'entity', targetId: 'asset', allowedOperations: ['append']
    }],
    extensions: [],
    blueprint: {
      entities: [{
        id: 'asset', name: '资产', retention: 'protected', history: false, systemManaged: false,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          { id: 'name', name: '名称', type: 'text', required: true, unique: false }
        ], relations: []
      }],
      modules: [{
        id: 'assets', name: '资产台账', route: 'assets', entity: 'asset', actions: ['list', 'view']
      }],
      workflows: [], roles: [],
      dashboards: [{ id: 'asset_total', name: '资产总数', entity: 'asset', aggregation: 'count', filters: [] }]
    },
    seed: { records: { asset: [{ code: 'AST-001', name: '核心节点' }] } }
  });
}

function inspectionPack(invalidEntityReference = false): LoadedPack {
  return loaded('inspection_rectification', ['inspection.core'], {
    fragmentVersion: '1.0', pack: { id: 'inspection_rectification', version: '1.0.0' },
    owns: {
      entities: ['inspection'], modules: ['inspections'], workflows: ['inspection_flow'], roles: ['inspector']
    },
    publicExtensionPoints: [],
    extensions: [{
      point: 'asset.fields', operation: 'append', path: '/fields',
      value: { id: 'inspection_note', name: '巡检备注', type: 'text', required: false, unique: false }
    }],
    blueprint: {
      entities: [{
        id: 'inspection', name: '巡检', retention: 'protected', history: false, systemManaged: false,
        fields: [
          { id: 'code', name: '编码', type: 'text', required: true, unique: true },
          {
            id: 'asset_code', name: '资产', type: 'reference', required: true, unique: false,
            reference: { entity: invalidEntityReference ? 'missing_asset' : 'asset', field: 'code' }
          },
          {
            id: 'status', name: '状态', type: 'enum', required: true, unique: false,
            options: ['planned', 'archived']
          }
        ],
        relations: [{
          id: 'inspection_asset', name: '资产', field: 'asset_code',
          targetEntity: invalidEntityReference ? 'missing_asset' : 'asset', targetField: 'code', onDelete: 'restrict'
        }]
      }],
      modules: [{
        id: 'inspections', name: '巡检中心', route: 'inspections', entity: 'inspection',
        actions: ['list', 'view', 'archive']
      }],
      workflows: [{
        id: 'inspection_flow', name: '巡检流程', entity: 'inspection',
        initialState: 'planned', terminalStates: ['archived'], states: ['planned', 'archived'],
        transitions: [{
          id: 'archive', name: '归档', from: 'planned', to: 'archived',
          permission: 'inspections.archive', conditions: [], actions: [{ type: 'write_audit', parameters: {} }]
        }]
      }],
      roles: [{ id: 'inspector', name: '巡检员', permissions: ['inspections.list', 'inspections.view', 'inspections.archive'] }],
      dashboards: []
    },
    seed: { records: { inspection: [{ code: 'INS-001', asset_code: 'AST-001', status: 'planned' }] } }
  }, ['asset.core'], ['asset_registry']);
}

function request(order = ['inspection_rectification', 'asset_registry']): CompositionRequest {
  return {
    blueprintSchemaVersion: '1.0',
    runtimeVersion: '1.0.0',
    software: {
      id: 'inspection_app', name: '设备巡检管理软件', version: '1.0.0',
      purpose: '管理设备巡检', targetUsers: ['巡检员'], boundaries: ['离线运行'], loginMode: 'required'
    },
    selections: order.map((id) => ({ id, version: '1.0.0', config: {} })),
    coverage: { supported: ['资产台账', '巡检归档'], unsupported: [] },
    materials: {
      developmentPurpose: '形成设备巡检记录', industry: '设备管理',
      technicalFeatures: ['离线运行', '关系数据持久化']
    }
  };
}

test('composes, validates and locks packs deterministically', () => {
  const registry = new PackRegistry();
  registry.register(assetPack()); registry.register(inspectionPack());

  const first = composeDomainPacks(request(), registry);
  const second = composeDomainPacks(request(['asset_registry', 'inspection_rectification']), registry);

  assert.equal(first.valid, true);
  assert.equal(first.canGenerate, true);
  assert.deepEqual(first.issues, []);
  assert.deepEqual(first.lock?.dependencyOrder, ['asset_registry', 'inspection_rectification']);
  assert.equal(first.lock?.packs[0]!.id, 'asset_registry');
  assert.deepEqual(canonicalJson(first.blueprint), canonicalJson(second.blueprint));
  assert.deepEqual(canonicalJson(first.lock), canonicalJson(second.lock));
  const asset = (first.blueprint!.entities as any[]).find((item) => item.id === 'asset');
  assert.ok(asset.fields.some((field: any) => field.id === 'inspection_note'));
  assert.equal((first.report.ownership as any).asset, 'asset_registry');
});

test('short-circuits dependency and merge failures without output artifacts', () => {
  const missing = new PackRegistry();
  missing.register(inspectionPack());
  const dependencyFailure = composeDomainPacks(request(['inspection_rectification']), missing);
  assert.equal(dependencyFailure.canGenerate, false);
  assert.equal(dependencyFailure.blueprint, undefined);
  assert.equal(dependencyFailure.lock, undefined);
  assert.ok(dependencyFailure.issues.some((item) => item.code === 'CAPABILITY_MISSING'));

  const registry = new PackRegistry();
  const base = assetPack();
  const broken = inspectionPack();
  (broken.fragment.extensions as any).push({
    point: 'asset.fields', operation: 'append', path: '/missing', value: { id: 'bad' }
  });
  registry.register(base); registry.register(broken);
  const mergeFailure = composeDomainPacks(request(), registry);
  assert.equal(mergeFailure.blueprint, undefined);
  assert.ok(mergeFailure.issues.some((item) => item.code === 'MERGE_CONFLICT'));
});

test('converts composed blueprint validation failures', () => {
  const registry = new PackRegistry();
  registry.register(assetPack()); registry.register(inspectionPack(true));
  const result = composeDomainPacks(request(), registry);

  assert.equal(result.valid, true);
  assert.equal(result.canGenerate, false);
  assert.equal(result.blueprint, undefined);
  assert.ok(result.issues.some((item) => item.code === 'COMPOSED_BLUEPRINT_INVALID'));
});

test('preserves unsupported requirements and blocks outputs', () => {
  const registry = new PackRegistry();
  registry.register(assetPack()); registry.register(inspectionPack());
  const blockedRequest = structuredClone(request()) as any;
  blockedRequest.coverage.unsupported = ['自动控制生产设备'];
  const result = composeDomainPacks(blockedRequest, registry);

  assert.equal(result.valid, true);
  assert.equal(result.canGenerate, false);
  assert.equal(result.blueprint, undefined);
  assert.equal(result.lock, undefined);
  assert.match(result.summary, /UNSUPPORTED_REQUIREMENT/);
});
