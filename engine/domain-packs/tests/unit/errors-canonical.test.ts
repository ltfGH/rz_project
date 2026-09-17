import test from 'node:test';
import assert from 'node:assert/strict';

import { issue, sortIssues, summarizeIssues } from '../../src/shared/errors';
import { canonicalJson } from '../../src/shared/canonical-json';

test('creates frozen issues and applies deterministic sorting', () => {
  const input = [
    issue('MERGE_CONFLICT', 'inspection', '/z', 'second'),
    issue('PACK_CATALOG_INVALID', 'asset_registry', '/version', 'Version is invalid.'),
    issue('MERGE_CONFLICT', 'inspection', '/a', 'last'),
    issue('MERGE_CONFLICT', 'inspection', '/a', 'first')
  ];

  assert.deepEqual(input[1], {
    code: 'PACK_CATALOG_INVALID',
    packId: 'asset_registry',
    path: '/version',
    message: 'Version is invalid.',
    severity: 'error'
  });
  assert.equal(Object.isFrozen(input[1]), true);
  assert.deepEqual(sortIssues(input).map((entry) => entry.message), [
    'Version is invalid.', 'first', 'last', 'second'
  ]);
  assert.equal(input[0]!.path, '/z');
});

test('formats deterministic summaries with a length cap', () => {
  const issues = [issue('PACK_NOT_FOUND', 'asset_registry', '/packs/0', 'Pack is missing.')];
  assert.equal(
    summarizeIssues(issues),
    '[PACK_NOT_FOUND] asset_registry /packs/0: Pack is missing.'
  );
  assert.equal(summarizeIssues(issues, 12), '[PACK_NOT_FO');
});

test('writes recursively sorted canonical JSON and preserves array order', () => {
  const value = {
    z: 1,
    nested: { beta: true, alpha: '值' },
    array: [{ z: 2, a: 1 }, 'second', 'first']
  };

  assert.equal(
    canonicalJson(value),
    '{"array":[{"a":1,"z":2},"second","first"],"nested":{"alpha":"值","beta":true},"z":1}\n'
  );
});

test('rejects unsupported and cyclic values', () => {
  assert.throws(() => canonicalJson({ value: undefined }), /Unsupported JSON value/);
  assert.throws(() => canonicalJson({ value: BigInt(1) }), /Unsupported JSON value/);
  assert.throws(() => canonicalJson({ value: () => true }), /Unsupported JSON value/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /Cyclic JSON value/);
});
