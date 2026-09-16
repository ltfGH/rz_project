'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { issue, sortIssues, summarizeIssues } = require('../../blueprint/issues.cjs');

test('creates immutable validation issues with an error default', () => {
  const value = issue('REFERENCE_ENTITY_UNKNOWN', '/modules/0/entity', "Unknown entity 'missing'.");

  assert.deepEqual(value, {
    code: 'REFERENCE_ENTITY_UNKNOWN',
    path: '/modules/0/entity',
    message: "Unknown entity 'missing'.",
    severity: 'error'
  });
  assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { value.code = 'CHANGED'; }, TypeError);
});

test('rejects unsupported issue severities', () => {
  assert.throws(
    () => issue('CODE', '/', 'message', 'fatal'),
    /Unsupported issue severity 'fatal'/
  );
});

test('sorts issues by path, code, and message without mutating input', () => {
  const input = [
    issue('B', '/z', 'second'),
    issue('B', '/a', 'second'),
    issue('A', '/a', 'last'),
    issue('A', '/a', 'first')
  ];

  const result = sortIssues(input);

  assert.deepEqual(result.map((entry) => entry.message), ['first', 'last', 'second', 'second']);
  assert.equal(input[0].path, '/z');
  assert.notEqual(result, input);
});

test('formats one issue per line and truncates to the requested maximum', () => {
  const issues = [
    issue('FIRST', '/a', 'alpha'),
    issue('SECOND', '/b', 'beta')
  ];

  assert.equal(summarizeIssues(issues), '[FIRST] /a: alpha\n[SECOND] /b: beta');
  assert.equal(summarizeIssues(issues, 18), '[FIRST] /a: alpha\n');
});
