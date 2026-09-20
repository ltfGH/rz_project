'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadCatalog } = require('../../blueprint/catalog.cjs');

function writeCatalog(directory, archetypes, plugins) {
  const archetypePath = path.join(directory, 'archetypes.json');
  const pluginPath = path.join(directory, 'plugins.json');
  fs.writeFileSync(archetypePath, JSON.stringify({ catalogVersion: '1.0', archetypes }), 'utf8');
  fs.writeFileSync(pluginPath, JSON.stringify({ catalogVersion: '1.0', plugins }), 'utf8');
  return { archetypePath, pluginPath };
}

function archetype(id, allowedPlugins = []) {
  return {
    id,
    name: id,
    description: `${id} description`,
    allowedPlugins,
    requiredCapabilities: ['entity_crud']
  };
}

function plugin(id, compatibleArchetypes) {
  return {
    id,
    name: id,
    description: `${id} description`,
    compatibleArchetypes,
    configKeys: { required: [], optional: [] }
  };
}

test('loads the checked-in catalog and freezes nested descriptors', () => {
  const catalog = loadCatalog();

  assert.deepEqual([...catalog.archetypes.keys()], [
    'asset_registry',
    'inspection_rectification',
    'work_order_service',
    'inventory_batch',
    'project_task',
    'application_archive',
    'domain_document_bridge',
    'asset_work_order_bridge',
    'asset_inspection_bridge'
  ]);
  assert.equal(catalog.plugins.size, 9);
  assert.deepEqual(catalog.archetypes.get('domain_document_bridge').allowedPlugins,
    ['application_archive', 'domain_document_bridge']);
  assert.deepEqual(catalog.plugins.get('domain_document_bridge').compatibleArchetypes,
    ['application_archive', 'domain_document_bridge']);
  assert.deepEqual(catalog.archetypes.get('asset_work_order_bridge').allowedPlugins,
    ['asset_registry', 'work_order_service', 'asset_work_order_bridge']);
  assert.deepEqual(catalog.plugins.get('asset_work_order_bridge').compatibleArchetypes,
    ['asset_registry', 'work_order_service', 'asset_work_order_bridge']);
  const descriptor = catalog.archetypes.get('asset_registry');
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.allowedPlugins), true);
  assert.throws(() => descriptor.allowedPlugins.push('other'), TypeError);
});

test('rejects duplicate archetype IDs', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-catalog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const paths = writeCatalog(
    directory,
    [archetype('duplicate'), archetype('duplicate')],
    []
  );

  assert.throws(() => loadCatalog(paths), /Duplicate archetype ID 'duplicate'.*archetypes\.json/);
});

test('rejects duplicate plugin IDs', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-catalog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const paths = writeCatalog(
    directory,
    [archetype('asset_registry', ['shared_plugin'])],
    [plugin('shared_plugin', ['asset_registry']), plugin('shared_plugin', ['asset_registry'])]
  );

  assert.throws(() => loadCatalog(paths), /Duplicate plugin ID 'shared_plugin'.*plugins\.json/);
});

test('rejects archetypes that reference unknown plugins', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-catalog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const paths = writeCatalog(
    directory,
    [archetype('asset_registry', ['missing_plugin'])],
    []
  );

  assert.throws(
    () => loadCatalog(paths),
    /Archetype 'asset_registry' references unknown plugin 'missing_plugin'/
  );
});
