'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadCatalog } = require('../../blueprint/catalog.cjs');
const { validateReferences } = require('../../blueprint/references.cjs');
const { validBlueprint, clone } = require('./helpers.cjs');

const catalog = loadCatalog();

function expectIssue(blueprint, code, path) {
  const issues = validateReferences(blueprint, catalog);
  assert.ok(
    issues.some((entry) => entry.code === code && entry.path === path),
    `Expected ${code} at ${path}; got ${JSON.stringify(issues)}`
  );
}

test('accepts valid references and a plugin shared by a compatible archetype', () => {
  const blueprint = validBlueprint();
  blueprint.archetypes.push('work_order_service');
  blueprint.plugins.push({ id: 'work_order_service', config: {} });

  assert.deepEqual(validateReferences(blueprint, catalog), []);
});

test('rejects duplicate IDs within each named collection', () => {
  const blueprint = validBlueprint();
  blueprint.entities.push(clone(blueprint.entities[0]));

  expectIssue(blueprint, 'DUPLICATE_ID', '/entities/1/id');
});

test('rejects unknown archetypes', () => {
  const blueprint = validBlueprint();
  blueprint.archetypes[0] = 'unknown_archetype';

  expectIssue(blueprint, 'ARCHETYPE_UNKNOWN', '/archetypes/0');
});

test('rejects unknown plugins', () => {
  const blueprint = validBlueprint();
  blueprint.plugins[0].id = 'unknown_plugin';

  expectIssue(blueprint, 'PLUGIN_UNKNOWN', '/plugins/0/id');
});

test('rejects plugins incompatible with every selected archetype', () => {
  const blueprint = validBlueprint();
  blueprint.archetypes = ['asset_registry'];
  blueprint.capabilities = ['entity_crud', 'relationships', 'audit'];
  blueprint.plugins = [{ id: 'application_archive', config: {} }];

  expectIssue(blueprint, 'PLUGIN_INCOMPATIBLE', '/plugins/0/id');
});

test('rejects missing required plugin configuration', () => {
  const blueprint = validBlueprint();
  blueprint.archetypes = ['inventory_batch'];
  blueprint.capabilities = ['entity_crud', 'relationships', 'transactions', 'audit'];
  blueprint.plugins = [{ id: 'inventory_batch', config: {} }];

  expectIssue(blueprint, 'PLUGIN_CONFIG_MISSING', '/plugins/0/config/quantity_scale');
});

test('rejects unknown plugin configuration', () => {
  const blueprint = validBlueprint();
  blueprint.plugins[0].config.unrecognized = true;

  expectIssue(blueprint, 'PLUGIN_CONFIG_UNKNOWN', '/plugins/0/config/unrecognized');
});

test('rejects capabilities required by selected archetypes', () => {
  const blueprint = validBlueprint();
  blueprint.capabilities = blueprint.capabilities.filter((value) => value !== 'transactions');

  expectIssue(blueprint, 'CAPABILITY_MISSING', '/capabilities');
});

test('rejects modules that reference unknown entities', () => {
  const blueprint = validBlueprint();
  blueprint.modules[0].entity = 'missing_entity';

  expectIssue(blueprint, 'REFERENCE_ENTITY_UNKNOWN', '/modules/0/entity');
});

test('rejects reference fields that target unknown fields', () => {
  const blueprint = validBlueprint();
  blueprint.entities[0].fields.push({
    id: 'parent_id',
    name: '父设备',
    type: 'reference',
    required: false,
    unique: false,
    reference: { entity: 'asset', field: 'missing_field' }
  });

  expectIssue(blueprint, 'REFERENCE_FIELD_UNKNOWN', '/entities/0/fields/2/reference/field');
});

test('rejects relations that target unknown entities', () => {
  const blueprint = validBlueprint();
  blueprint.entities[0].relations.push({
    id: 'asset_parent',
    name: '父设备',
    field: 'code',
    targetEntity: 'missing_entity',
    targetField: 'code',
    onDelete: 'restrict'
  });

  expectIssue(blueprint, 'REFERENCE_ENTITY_UNKNOWN', '/entities/0/relations/0/targetEntity');
});

test('distinguishes unknown permission modules from unknown actions', () => {
  const missingModule = validBlueprint();
  missingModule.roles[0].permissions.push('missing.view');
  expectIssue(missingModule, 'REFERENCE_MODULE_UNKNOWN', '/roles/0/permissions/4');

  const missingAction = validBlueprint();
  missingAction.roles[0].permissions.push('assets.delete');
  expectIssue(missingAction, 'REFERENCE_PERMISSION_UNKNOWN', '/roles/0/permissions/4');
});

test('rejects workflows and dashboards with unknown data sources', () => {
  const workflowBlueprint = validBlueprint();
  workflowBlueprint.workflows.push({
    id: 'asset_flow',
    name: '资产流程',
    entity: 'missing_entity',
    initialState: 'active',
    terminalStates: ['inactive'],
    states: ['active', 'inactive'],
    transitions: [{
      id: 'deactivate', name: '停用', from: 'active', to: 'inactive',
      permission: 'assets.update', conditions: [], actions: []
    }]
  });
  expectIssue(workflowBlueprint, 'REFERENCE_ENTITY_UNKNOWN', '/workflows/0/entity');

  const dashboardBlueprint = validBlueprint();
  dashboardBlueprint.dashboards.push({
    id: 'asset_total', name: '资产总数', entity: 'missing_entity',
    aggregation: 'count', filters: []
  });
  expectIssue(dashboardBlueprint, 'DASHBOARD_SOURCE_UNKNOWN', '/dashboards/0/entity');
});

test('reports every unsupported requirement as a generation-blocking issue', () => {
  const blueprint = validBlueprint();
  blueprint.coverage.unsupported = ['自动控制设备', '法规合规判定'];

  const issues = validateReferences(blueprint, catalog)
    .filter((entry) => entry.code === 'UNSUPPORTED_REQUIREMENT');
  assert.deepEqual(issues.map((entry) => entry.path), [
    '/coverage/unsupported/0',
    '/coverage/unsupported/1'
  ]);
  assert.ok(issues.every((entry) => entry.severity === 'error'));
});
