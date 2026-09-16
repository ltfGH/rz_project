'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRetention } = require('../../blueprint/retention.cjs');
const { validBlueprint } = require('./helpers.cjs');

function expectIssue(blueprint, code, path) {
  const issues = validateRetention(blueprint);
  assert.ok(
    issues.some((entry) => entry.code === code && entry.path === path),
    `Expected ${code} at ${path}; got ${JSON.stringify(issues)}`
  );
}

function relatedBlueprint({ required = true, onDelete = 'restrict' } = {}) {
  const blueprint = validBlueprint();
  blueprint.entities.push({
    id: 'inspection_event',
    name: '点检事件',
    retention: 'append_only',
    history: true,
    systemManaged: true,
    fields: [
      { id: 'code', name: '事件编码', type: 'text', required: true, unique: true },
      {
        id: 'asset_id', name: '设备', type: 'reference', required, unique: false,
        reference: { entity: 'asset', field: 'code' }
      }
    ],
    relations: [{
      id: 'event_asset', name: '所属设备', field: 'asset_id',
      targetEntity: 'asset', targetField: 'code', onDelete
    }]
  });
  blueprint.modules.push({
    id: 'events', name: '点检事件', route: 'events', entity: 'inspection_event', actions: ['list', 'view']
  });
  return blueprint;
}

test('accepts protected records and read-only append-only history', () => {
  assert.deepEqual(validateRetention(relatedBlueprint()), []);
});

test('rejects update and delete actions for append-only entities', () => {
  const blueprint = relatedBlueprint();
  blueprint.entities[1].history = false;
  blueprint.modules[1].actions.push('update', 'delete');

  expectIssue(blueprint, 'RETENTION_ACTION_FORBIDDEN', '/modules/1/actions/2');
  expectIssue(blueprint, 'RETENTION_ACTION_FORBIDDEN', '/modules/1/actions/3');
});

test('allows create on append-only entities only when system-managed', () => {
  const systemManaged = relatedBlueprint();
  systemManaged.modules[1].actions.push('create');
  assert.deepEqual(validateRetention(systemManaged), []);

  const userManaged = relatedBlueprint();
  userManaged.entities[1].systemManaged = false;
  userManaged.modules[1].actions.push('create');
  expectIssue(userManaged, 'RETENTION_ACTION_FORBIDDEN', '/modules/1/actions/2');
});

test('rejects delete actions for history entities regardless of retention mode', () => {
  const blueprint = relatedBlueprint();
  blueprint.entities[1].retention = 'mutable';
  blueprint.modules[1].actions.push('delete');

  expectIssue(blueprint, 'HISTORY_DELETE_FORBIDDEN', '/modules/1/actions/2');
});

test('rejects set-null deletion for required relations', () => {
  const blueprint = relatedBlueprint({ required: true, onDelete: 'set_null' });

  expectIssue(
    blueprint,
    'RELATION_DELETE_POLICY_INVALID',
    '/entities/1/relations/0/onDelete'
  );
});

test('requires history entities to restrict deletion of their parent', () => {
  const blueprint = relatedBlueprint({ required: false, onDelete: 'set_null' });

  expectIssue(
    blueprint,
    'RELATION_DELETE_POLICY_INVALID',
    '/entities/1/relations/0/onDelete'
  );
});

test('rejects cascade deletion into append-only or history entities', () => {
  const blueprint = validBlueprint();
  blueprint.entities[0].fields.push({
    id: 'event_id', name: '事件', type: 'reference', required: true, unique: false,
    reference: { entity: 'inspection_event', field: 'code' }
  });
  blueprint.entities[0].relations.push({
    id: 'asset_event', name: '事件', field: 'event_id',
    targetEntity: 'inspection_event', targetField: 'code', onDelete: 'cascade'
  });
  blueprint.entities.push({
    id: 'inspection_event', name: '点检事件', retention: 'append_only', history: true,
    systemManaged: true,
    fields: [{ id: 'code', name: '编码', type: 'text', required: true, unique: true }],
    relations: []
  });

  expectIssue(
    blueprint,
    'RELATION_DELETE_POLICY_INVALID',
    '/entities/0/relations/0/onDelete'
  );
});
