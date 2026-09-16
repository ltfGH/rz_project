'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const validateStructure = require('../../blueprint/generated/validate-blueprint-structure.cjs');
const { validBlueprint } = require('./helpers.cjs');

function expectInvalid(mutate, keyword) {
  const blueprint = validBlueprint();
  mutate(blueprint);
  assert.equal(validateStructure(blueprint), false);
  assert.ok(validateStructure.errors.some((entry) => entry.keyword === keyword));
}

test('accepts the smallest complete blueprint contract', () => {
  assert.equal(validateStructure(validBlueprint()), true);
  assert.equal(validateStructure.errors, null);
});

test('rejects unknown top-level properties', () => {
  expectInvalid((blueprint) => { blueprint.extra = true; }, 'additionalProperties');
});

test('rejects identifiers outside lower snake case', () => {
  expectInvalid((blueprint) => { blueprint.entities[0].id = 'AssetRecord'; }, 'pattern');
});

test('rejects unsupported field types', () => {
  expectInvalid((blueprint) => { blueprint.entities[0].fields[0].type = 'blob'; }, 'enum');
});

test('rejects a missing required section', () => {
  expectInvalid((blueprint) => { delete blueprint.materials; }, 'required');
});
