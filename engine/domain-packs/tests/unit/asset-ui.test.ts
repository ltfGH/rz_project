import test from 'node:test';
import assert from 'node:assert/strict';

import catalog from '../../packs/asset_registry/catalog.json';
import { assetUiDescriptor } from '../../packs/asset_registry/ui/index';

test('registers only asset detail tabs and actions as pure descriptors', () => {
  assert.deepEqual(
    [...assetUiDescriptor.slots],
    ['entity.detail.tabs', 'entity.detail.actions']
  );
  assert.deepEqual(catalog.uiSlots, [...assetUiDescriptor.slots]);
  assert.deepEqual(
    assetUiDescriptor.extensions.map((extension) => extension.id),
    ['asset.responsibilities.tab', 'asset.status_history.tab', 'asset.status.actions']
  );
  assert.deepEqual(
    assetUiDescriptor.extensions.map((extension) => extension.slot),
    ['entity.detail.tabs', 'entity.detail.tabs', 'entity.detail.actions']
  );
  assert.ok(assetUiDescriptor.extensions.every((extension) => extension.entityId === 'asset'));
  assert.deepEqual(
    assetUiDescriptor.extensions.map((extension) => extension.label),
    ['责任关系', '状态历史', '状态操作']
  );

  assert.equal(containsFunction(assetUiDescriptor), false);
  assert.doesNotMatch(
    JSON.stringify(assetUiDescriptor),
    /"(?:login|session|navigation|navbar|maintenance|backup|ipc|database)"\s*:/i
  );
});

function containsFunction(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (Array.isArray(value)) return value.some(containsFunction);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(containsFunction);
  }
  return false;
}
