import test from 'node:test';
import assert from 'node:assert/strict';

import catalog from '../../packs/work_order_service/catalog.json';
import { workOrderUiDescriptor } from '../../packs/work_order_service/ui/index';

test('registers only declared work order slots as pure descriptors', () => {
  assert.deepEqual([...workOrderUiDescriptor.slots], catalog.uiSlots);
  assert.deepEqual(
    workOrderUiDescriptor.extensions.map((extension) => extension.id),
    [
      'work_order.processing.tab',
      'work_order.history.tab',
      'work_order.sla.tab',
      'work_order.lifecycle.actions',
      'work_order.sla.dashboard',
      'sla_policy.manage.actions'
    ]
  );
  assert.deepEqual(
    workOrderUiDescriptor.extensions.map((extension) => extension.slot),
    [
      'entity.detail.tabs',
      'entity.detail.tabs',
      'entity.detail.tabs',
      'entity.detail.actions',
      'dashboard.sections',
      'entity.detail.actions'
    ]
  );
  assert.equal(containsFunction(workOrderUiDescriptor), false);
  assert.doesNotMatch(
    JSON.stringify(workOrderUiDescriptor),
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
