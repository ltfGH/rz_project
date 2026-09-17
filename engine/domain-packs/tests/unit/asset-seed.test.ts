import test from 'node:test';
import assert from 'node:assert/strict';

import { generateAssetSeed } from '../../packs/asset_registry/seed/index';

test('generates byte-stable records for the same numeric seed', () => {
  const first = generateAssetSeed({ seed: 20260917, categoryCount: 3, assetCount: 8 });
  const second = generateAssetSeed({ seed: 20260917, categoryCount: 3, assetCount: 8 });
  const another = generateAssetSeed({ seed: 20260918, categoryCount: 3, assetCount: 8 });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.notEqual(JSON.stringify(first), JSON.stringify(another));
});

test('emits exact counts, unique codes and valid references', () => {
  const seed = generateAssetSeed({ seed: 17, categoryCount: 4, assetCount: 12 });
  assert.equal(seed.records.asset_category.length, 4);
  assert.equal(seed.records.asset.length, 12);
  assert.equal(seed.records.asset_responsibility.length, 12);
  assert.equal(seed.records.asset_event.length, 12);

  for (const records of Object.values(seed.records)) {
    const codes = records.map((record) => record.code);
    assert.equal(new Set(codes).size, codes.length);
  }
  const categoryCodes = new Set(seed.records.asset_category.map((record) => record.code));
  const assetCodes = new Set(seed.records.asset.map((record) => record.code));
  assert.ok(seed.records.asset.every((record) => categoryCodes.has(record.category_code)));
  assert.ok(seed.records.asset_responsibility.every((record) => assetCodes.has(record.asset_code)));
  assert.ok(seed.records.asset_event.every((record) => assetCodes.has(record.asset_code)));
  assert.ok(seed.records.asset_event.every((record) => (
    record.event_type === 'created' && record.from_status === null &&
    seed.records.asset.some((asset) => (
      asset.code === record.asset_code && asset.status === record.to_status
    ))
  )));
});

test('uses synthetic operational labels without applicant, company or person identity', () => {
  const seed = generateAssetSeed({ seed: 42, categoryCount: 3, assetCount: 10 });
  const serialized = JSON.stringify(seed);
  assert.doesNotMatch(serialized, /申请人|有限公司|公司|集团|张[\u4e00-\u9fa5]|李[\u4e00-\u9fa5]/);
  assert.ok(seed.records.asset_responsibility.every((record) => /^责任岗位-\d{2}$/.test(record.assignee)));
});
