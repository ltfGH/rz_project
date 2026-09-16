'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateBlueprint } = require('../../blueprint/validate.cjs');
const { validBlueprint, clone } = require('./helpers.cjs');

const fixtureRoot = path.resolve(__dirname, '..', 'fixtures', 'blueprints');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

test('returns only structural issues for malformed input', () => {
  const malformed = { schemaVersion: '1.0', entities: 'not-an-array' };

  const result = validateBlueprint(malformed);

  assert.equal(result.valid, false);
  assert.equal(result.canGenerate, false);
  assert.ok(result.issues.length > 0);
  assert.ok(result.issues.every((entry) => entry.code.startsWith('SCHEMA_')));
});

test('accepts a Demo-scale composite blueprint', () => {
  const result = validateBlueprint(loadFixture('enterprise-ops.valid.json'));

  assert.deepEqual(result, {
    valid: true,
    canGenerate: true,
    schemaVersion: '1.0',
    issues: [],
    summary: ''
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.issues), true);
});

test('keeps structurally valid unsupported blueprints inspectable but blocks generation', () => {
  const result = validateBlueprint(loadFixture('unsupported.invalid.json'));

  assert.equal(result.valid, true);
  assert.equal(result.canGenerate, false);
  assert.deepEqual(result.issues.map((entry) => entry.code), ['UNSUPPORTED_REQUIREMENT']);
});

test('blocks semantic errors without describing the structure as invalid', () => {
  const blueprint = validBlueprint();
  blueprint.entities.push(clone(blueprint.entities[0]));

  const result = validateBlueprint(blueprint);

  assert.equal(result.valid, true);
  assert.equal(result.canGenerate, false);
  assert.ok(result.issues.some((entry) => entry.code === 'DUPLICATE_ID'));
});

test('returns deterministic issues and does not mutate input', () => {
  const blueprint = validBlueprint();
  blueprint.modules[0].entity = 'missing_entity';
  blueprint.coverage.unsupported.push('外部设备控制');
  const before = clone(blueprint);

  const first = validateBlueprint(blueprint);
  const second = validateBlueprint(blueprint);

  assert.deepEqual(first, second);
  assert.deepEqual(blueprint, before);
  assert.deepEqual(first.issues.map((entry) => entry.code), [
    'UNSUPPORTED_REQUIREMENT',
    'REFERENCE_ENTITY_UNKNOWN'
  ]);
});
