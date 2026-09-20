import assert from 'node:assert/strict';
import test from 'node:test';

import { productionPluginDescriptors } from '../../src/runtime/production-catalog';

test('exports every existing production plugin exactly once at an exact version', () => {
  const identities = productionPluginDescriptors.map((descriptor) => (
    `${descriptor.id}@${descriptor.version}`
  ));
  assert.deepEqual(identities, [
    'application_archive@1.0.0',
    'asset_registry@1.0.0',
    'asset_work_order_bridge@1.0.0',
    'domain_document_bridge@1.0.0',
    'inspection_rectification@1.0.0',
    'inventory_batch@1.0.0',
    'project_task@1.0.0',
    'work_order_service@1.0.0'
  ]);
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(Object.isFrozen(productionPluginDescriptors), true);
});
