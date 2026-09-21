import test from 'node:test';
import assert from 'node:assert/strict';

import { generateStandardSeed } from '../../src/generator/standard-seed';
import { loadStandardTemplateCatalog } from '../../src/generator/standard-project';
import { builtTemplate, standardRequest, testDigests } from '../helpers/standard-generation';

function referenceFields(blueprint: any): Map<string, Array<{ field: string; target: string }>> {
  return new Map((blueprint.entities ?? []).map((entity: any) => [entity.id,
    entity.fields.filter((field: any) => field.type === 'reference')
      .map((field: any) => ({ field: field.id, target: field.reference.entity }))
  ]));
}

test('generates exactly 1000 deterministic valid business rows for all eight templates', () => {
  const catalog = loadStandardTemplateCatalog();
  for (const descriptor of catalog.templates) {
    const built = builtTemplate(descriptor);
    let first;
    try { first = generateStandardSeed(built.project, built.blueprint, testDigests); }
    catch (error) { throw new Error(`${descriptor.id}: ${error instanceof Error ? error.message : String(error)}`); }
    const second = generateStandardSeed(built.project, built.blueprint, testDigests);
    assert.deepEqual(first, second, descriptor.id);
    assert.equal(first.report.countedBusinessRows, 1000, descriptor.id);
    assert.equal(Object.values(first.report.counts).reduce((sum, count) => sum + count, 0), 1000);
    assert.equal(first.users.length, 4);
    assert.deepEqual(first.users.map((user) => user.roleId), [
      'operations_dispatcher', 'operations_operator', 'operations_reviewer', 'operations_admin'
    ]);
    assert.doesNotMatch(JSON.stringify(first), /DispatchPass|OperatorPass|ReviewPass|AdminPass/);

    const codes = new Map(Object.entries(first.records).map(([entity, rows]) => [
      entity, new Set(rows.map((row: any) => row.code))
    ]));
    for (const [entity, rows] of Object.entries(first.records)) {
      assert.equal(codes.get(entity)!.size, rows.length, `${descriptor.id}:${entity}`);
    }
    for (const [entity, refs] of referenceFields(built.blueprint)) {
      for (const row of first.records[entity] ?? []) {
        for (const ref of refs) {
          const value = (row as any)[ref.field];
          if (value !== null && value !== undefined) {
            assert.equal(codes.get(ref.target)?.has(value), true, `${descriptor.id}:${entity}.${ref.field}`);
          }
        }
      }
    }
  }
});

test('theme vocabulary changes only whitelisted display values', () => {
  const descriptor = loadStandardTemplateCatalog().templates.find((entry) => entry.id === 'asset_inspection_rectification')!;
  const base = builtTemplate(descriptor);
  const themedRequest = standardRequest(descriptor.id, {
    seedVocabulary: { asset_names: ['Fire Pump', 'Smoke Detector'], findings: ['Pressure alert'] }
  });
  const themed = builtTemplate(descriptor, themedRequest);
  const plainSeed = generateStandardSeed(base.project, base.blueprint, testDigests);
  const themedSeed = generateStandardSeed(themed.project, themed.blueprint, testDigests);
  assert.notEqual((plainSeed.records.asset?.[0] as any).name, (themedSeed.records.asset?.[0] as any).name);
  assert.deepEqual(
    plainSeed.records.asset?.map((row: any) => ({ code: row.code, category_code: row.category_code, status: row.status })),
    themedSeed.records.asset?.map((row: any) => ({ code: row.code, category_code: row.category_code, status: row.status }))
  );
  const invalid = builtTemplate(descriptor, standardRequest(descriptor.id, { seedVocabulary: { arbitrary_key: ['Bad'] } }));
  assert.throws(() => generateStandardSeed(invalid.project, invalid.blueprint, testDigests), /vocabulary/i);
});
