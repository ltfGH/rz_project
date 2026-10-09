import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDashboardModel } from '../../src/renderer/dashboard-model';
import type { DashboardSnapshotDto } from '../../src/shared/dto';

function snapshot(attentionValues = [2, 0, 4, 1]): DashboardSnapshotDto {
  return {
    metrics: [{ id: 'projects', name: 'Projects', value: 10, tone: 'teal' }],
    sections: [{
      id: 'project_dashboard', label: 'Project overview', order: 10,
      groups: [
        {
          id: 'status', label: 'Status', kind: 'status',
          items: [
            { id: 'active', label: 'Active', value: 10, tone: 'teal' },
            { id: 'planning', label: 'Planning', value: 5, tone: 'neutral' },
            { id: 'pending', label: 'Pending', value: 0, tone: 'amber' },
            { id: 'closed', label: 'Closed', value: 0, tone: 'neutral' }
          ]
        },
        {
          id: 'attention', label: 'Attention', kind: 'attention',
          items: [
            { id: 'review', label: 'Review', value: attentionValues[0] ?? 0, tone: 'amber', moduleId: 'tasks' },
            { id: 'none', label: 'None', value: attentionValues[1] ?? 0, tone: 'red' },
            { id: 'overdue', label: 'Overdue', value: attentionValues[2] ?? 0, tone: 'red', moduleId: 'projects' },
            { id: 'notice', label: 'Notice', value: attentionValues[3] ?? 0, tone: 'neutral' }
          ]
        }
      ]
    }]
  };
}

test('normalizes status ratios and severity-sorts only nonzero attention items', () => {
  const model = buildDashboardModel(snapshot());

  assert.deepEqual(model.statusGroups[0]?.items.map((item) => item.ratio), [1, 0.5, 0, 0]);
  assert.deepEqual(model.attentionItems.map((item) => item.id), ['overdue', 'review', 'notice']);
  assert.equal(model.attentionEmpty, false);
  assert.deepEqual(model.metrics, snapshot().metrics);
});

test('uses a safe zero denominator and reports a truly empty attention state', () => {
  const input = snapshot([0, 0, 0, 0]);
  const zeroStatus: DashboardSnapshotDto = {
    ...input,
    sections: input.sections.map((section) => ({
      ...section,
      groups: section.groups.map((group) => group.kind === 'status'
        ? { ...group, items: group.items.map((item) => ({ ...item, value: 0 })) }
        : group)
    }))
  };

  const model = buildDashboardModel(zeroStatus);

  assert.deepEqual(model.statusGroups[0]?.items.map((item) => item.ratio), [0, 0, 0, 0]);
  assert.deepEqual(model.attentionItems, []);
  assert.equal(model.attentionEmpty, true);
});

test('keeps descriptor order stable between attention items with the same tone', () => {
  const input = snapshot([2, 3, 4, 0]);
  const model = buildDashboardModel(input);

  assert.deepEqual(model.attentionItems.map((item) => item.id), ['none', 'overdue', 'review']);
});
