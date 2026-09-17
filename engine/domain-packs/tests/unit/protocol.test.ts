import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCatalog,
  parseCompositionRequest,
  parseFragment
} from '../../src/protocol/schemas';

function catalog(): any {
  return {
    catalogVersion: '1.0',
    id: 'inspection_rectification',
    version: '1.0.0',
    name: '巡检与整改',
    description: '巡检任务和异常整改闭环',
    blueprintSchemaVersions: ['1.0'],
    runtimeVersions: ['1.0.0'],
    provides: ['inspection.core'],
    requires: ['asset.core'],
    allowedDependencies: ['asset_registry', 'work_order_service'],
    migrationsVersion: 1,
    entrypoints: {
      fragment: 'blueprint.json',
      runtime: 'runtime/index.js',
      ui: 'ui/index.js',
      seed: 'seed/index.json',
      tests: 'tests/index.js'
    },
    uiSlots: ['entity.detail.tabs']
  };
}

function fragment(): any {
  return {
    fragmentVersion: '1.0',
    pack: { id: 'inspection_rectification', version: '1.0.0' },
    owns: {
      entities: ['inspection'], modules: ['inspections'], workflows: ['inspection_flow'], roles: []
    },
    publicExtensionPoints: [{
      id: 'inspection.detail.tabs', targetKind: 'entity', targetId: 'inspection',
      allowedOperations: ['append']
    }],
    extensions: [],
    blueprint: {
      entities: [{ id: 'inspection', name: '巡检' }],
      modules: [{ id: 'inspections', name: '巡检中心' }],
      workflows: [{ id: 'inspection_flow', name: '巡检流程' }],
      roles: [],
      dashboards: []
    },
    seed: { records: { inspection: [{ code: 'INS-001' }] } }
  };
}

test('parses and freezes complete catalogs and fragments', () => {
  const parsedCatalog = parseCatalog(catalog());
  const parsedFragment = parseFragment(fragment());

  assert.equal(parsedCatalog.id, 'inspection_rectification');
  assert.equal(parsedFragment.pack.version, '1.0.0');
  assert.equal(Object.isFrozen(parsedCatalog), true);
  assert.equal(Object.isFrozen(parsedCatalog.entrypoints), true);
  assert.equal(Object.isFrozen(parsedFragment.blueprint), true);
});

test('rejects unknown properties, invalid IDs, versions and duplicates', () => {
  assert.throws(() => parseCatalog({ ...catalog(), unknown: true }), /Unrecognized key/);
  assert.throws(() => parseCatalog({ ...catalog(), id: 'Inspection-Pack' }), /catalog/i);
  assert.throws(() => parseCatalog({ ...catalog(), version: 'v1' }), /catalog/i);
  assert.throws(() => parseCatalog({
    ...catalog(), provides: ['inspection.core', 'inspection.core']
  }), /catalog/i);
});

test('rejects unsafe entrypoint paths', () => {
  assert.throws(() => parseCatalog({
    ...catalog(), entrypoints: { ...catalog().entrypoints, runtime: '../runtime.js' }
  }), /entrypoint/i);
  assert.throws(() => parseCatalog({
    ...catalog(), entrypoints: { ...catalog().entrypoints, runtime: 'runtime\\index.js' }
  }), /entrypoint/i);
  assert.throws(() => parseCatalog({
    ...catalog(), entrypoints: { ...catalog().entrypoints, runtime: 'C:/runtime.js' }
  }), /entrypoint/i);
});

test('rejects unowned objects and invalid extension operations', () => {
  const unowned = fragment();
  unowned.owns.entities = [];
  assert.throws(() => parseFragment(unowned), /owned/i);

  const invalidOperation = fragment();
  invalidOperation.extensions = [{
    point: 'inspection.detail.tabs', operation: 'replace', path: '/tabs', value: {}
  }];
  assert.throws(() => parseFragment(invalidOperation), /fragment/i);
});

test('rejects executable-looking keys but permits code as an ID value', () => {
  const safe = fragment();
  safe.blueprint.entities[0].fields = [{ id: 'code', name: '编码' }];
  const parsed = parseFragment(safe) as any;
  assert.equal(parsed.blueprint.entities[0].fields[0].id, 'code');

  const unsafe = fragment();
  unsafe.blueprint.entities[0].rules = { script: 'return true' };
  assert.throws(() => parseFragment(unsafe), /executable key 'script'/);
});

test('parses strict composition requests and selection config', () => {
  const request = {
    blueprintSchemaVersion: '1.0',
    runtimeVersion: '1.0.0',
    software: { id: 'inspection_app', name: '巡检软件' },
    selections: [{ id: 'inspection_rectification', version: '1.0.0', config: {} }],
    coverage: { supported: ['巡检'], unsupported: [] },
    materials: { industry: '企业管理' }
  };
  assert.equal(parseCompositionRequest(request).selections[0]!.id, 'inspection_rectification');
  assert.throws(() => parseCompositionRequest({
    ...request, selections: [{ ...request.selections[0], extra: true }]
  }), /request/i);
});
