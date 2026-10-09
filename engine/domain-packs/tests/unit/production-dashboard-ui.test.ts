import assert from 'node:assert/strict';
import test from 'node:test';

import { applicationUiDescriptor } from '../../packs/application_archive/ui/index';
import { inspectionUiDescriptor } from '../../packs/inspection_rectification/ui/index';
import { inventoryUiDescriptor } from '../../packs/inventory_batch/ui/index';
import { projectUiDescriptor } from '../../packs/project_task/ui/index';
import { workOrderUiDescriptor } from '../../packs/work_order_service/ui/index';

const descriptors = [
  applicationUiDescriptor, inspectionUiDescriptor, workOrderUiDescriptor,
  inventoryUiDescriptor, projectUiDescriptor
] as readonly any[];

const expected: Record<string, { status: readonly string[]; attention: readonly string[] }> = {
  application_archive:{
    status:['draft','approving','approved','archived'],
    attention:['pendingMyApprovals','upcomingCertificates','expiredCertificates','pendingReminders','stagedFiles','failedFiles']
  },
  inspection_rectification:{
    status:['pending','executing','pendingReview','archived'],
    attention:['pendingReview','abnormalItems']
  },
  work_order_service:{status:['total','closed'],attention:['pendingReview','overdue']},
  inventory_batch:{
    status:['materials','warehouses','batches','totalQuantity','transactions'],
    attention:['warningBatches','expiredBatches']
  },
  project_task:{
    status:['planning','active','pendingClose','closed'],
    attention:['overdueProjects','overdueMilestones','pendingTaskReviews','openHighRisks','submittedDeliverables']
  }
};

test('declares strict status and attention mappings for every dashboard pack', () => {
  assert.equal(descriptors.length, 5);
  for (const descriptor of descriptors) {
    const dashboard = descriptor.extensions.find((entry: any) => entry.slot === 'dashboard.sections');
    assert.ok(dashboard, `${descriptor.id} dashboard contribution`);
    assert.ok(dashboard.presentation, `${descriptor.id} dashboard presentation`);
    const groups = dashboard.presentation.groups as readonly any[];
    const status = groups.find((group) => group.kind === 'status');
    const attention = groups.find((group) => group.kind === 'attention');
    assert.deepEqual(status?.items.map((item: any) => item.sourceKey), expected[descriptor.id]?.status, `${descriptor.id} status`);
    assert.deepEqual(attention?.items.map((item: any) => item.sourceKey), expected[descriptor.id]?.attention, `${descriptor.id} attention`);
    for (const item of attention?.items ?? []) assert.match(item.moduleId, /^[a-z][a-z0-9_]{1,63}$/);
    for (const item of attention?.items.filter((entry: any) => entry.tone === 'red') ?? []) {
      assert.match(item.sourceKey, /overdue|expired|failed|abnormal|HighRisk/i);
    }
    assert.equal(Object.isFrozen(dashboard.presentation), true);
    assert.equal(Object.isFrozen(groups), true);
  }
});
