import assert from 'node:assert/strict';
import test from 'node:test';

import type { PluginContributionSink, PluginDescriptor } from '../../../desktop-runtime/src/core/plugin-registry';
import { applicationRuntimeDescriptor } from '../../packs/application_archive/runtime/index';
import { assetRuntimeDescriptor } from '../../packs/asset_registry/runtime/index';
import { inspectionRuntimeDescriptor } from '../../packs/inspection_rectification/runtime/index';
import { inventoryRuntimeDescriptor } from '../../packs/inventory_batch/runtime/index';
import { projectRuntimeDescriptor } from '../../packs/project_task/runtime/index';
import { workOrderRuntimeDescriptor } from '../../packs/work_order_service/runtime/index';
import type { PluginDomainAction } from '../../src/runtime/action-types';

const descriptors: readonly PluginDescriptor[] = Object.freeze([
  applicationRuntimeDescriptor,
  assetRuntimeDescriptor,
  inspectionRuntimeDescriptor,
  inventoryRuntimeDescriptor,
  projectRuntimeDescriptor,
  workOrderRuntimeDescriptor
]);

function collect(register: (sink: PluginContributionSink) => void): Map<string, unknown> {
  const values = new Map<string, unknown>();
  register({
    register: (_pluginId, contributionId, contribution) => {
      assert.equal(values.has(contributionId), false, `duplicate contribution ${contributionId}`);
      values.set(contributionId, contribution);
    }
  });
  return values;
}

test('every core IPC command has one executable action with the same permission', () => {
  for (const descriptor of descriptors) {
    const ipc = collect((sink) => descriptor.registerIpc(sink));
    assert.ok(descriptor.registerDomainActions, `${descriptor.id} has no executable actions`);
    const actions = collect((sink) => descriptor.registerDomainActions!(sink));
    assert.deepEqual([...actions.keys()], [...ipc.keys()], `${descriptor.id} action IDs differ`);

    for (const [id, contribution] of actions) {
      const action = contribution as PluginDomainAction;
      const binding = ipc.get(id) as { permission: string };
      assert.equal(action.id, id);
      assert.equal(action.permission, binding.permission);
      assert.equal(typeof action.parse, 'function');
      assert.equal(typeof action.execute, 'function');
    }
  }
});
