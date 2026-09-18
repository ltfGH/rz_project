import test from 'node:test'; import assert from 'node:assert/strict';
import catalog from '../../packs/inspection_rectification/catalog.json';
import { inspectionUiDescriptor } from '../../packs/inspection_rectification/ui/index';
test('registers declared inspection slots as pure descriptors', () => {
  assert.deepEqual([...inspectionUiDescriptor.slots], catalog.uiSlots);
  assert.deepEqual(inspectionUiDescriptor.extensions.map((x) => x.id), ['inspection.items.tab','inspection.anomalies.tab','inspection.history.tab','inspection.lifecycle.actions','inspection.plan.actions','inspection.dashboard']);
  assert.equal(hasFunction(inspectionUiDescriptor), false);
  assert.doesNotMatch(JSON.stringify(inspectionUiDescriptor), /"(?:login|session|navigation|maintenance|backup|ipc|database)"\s*:/i);
});
function hasFunction(value: unknown): boolean { if (typeof value === 'function') return true; if (Array.isArray(value)) return value.some(hasFunction); return value !== null && typeof value === 'object' ? Object.values(value).some(hasFunction) : false; }
