import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProjectActionInput,
  getProjectActionForm,
  getProjectActionInitialValues,
  projectActionFormIds
} from '../../src/renderer/domain/project-action-forms';

const record = (id = 17, version = 4, values: Record<string, unknown> = {}) => ({ id, version, values } as any);

test('declares the exact fixed mutating project action forms', () => {
  assert.deepEqual(projectActionFormIds, [
    'project.create','project.update','project.activate','project.request_close',
    'project.reject_close','project.approve_close','project.milestone.create',
    'project.milestone.complete','project.task.create','project.task.update',
    'project.task.start','project.task.progress','project.task.submit',
    'project.task.reject','project.task.approve','project.task.cancel',
    'project.task.restore','project.risk.create','project.risk.mitigate',
    'project.risk.close','project.risk.reopen','project.deliverable.submit',
    'project.deliverable.review'
  ]);
  assert.equal(getProjectActionForm('project.create')?.scope, 'module');
  assert.equal(getProjectActionForm('project.create')?.entityId, 'project');
  assert.equal(getProjectActionForm('project.summary'), undefined);
  assert.equal(getProjectActionForm('project.dashboard_summary'), undefined);
  assert.equal(projectActionFormIds.filter((id) => getProjectActionForm(id)?.scope === 'module').length, 1);
});

test('builds typed module and selected-project child requests', () => {
  assert.deepEqual(buildProjectActionInput(getProjectActionForm('project.create')!, {
    name: 'Edge Distribution', managerId: 'dispatcher',
    plannedStartAt: '2026-10-01', plannedEndAt: '2026-12-31'
  }), {
    name: 'Edge Distribution', managerId: 'dispatcher',
    plannedStartAt: '2026-10-01', plannedEndAt: '2026-12-31'
  });
  assert.deepEqual(buildProjectActionInput(getProjectActionForm('project.task.create')!, {
    milestoneCode: '', title: 'Distribute package', description: 'Send package to edge nodes',
    assigneeId: 'operator', weight: '25', required: true
  }, record()), {
    projectId: 17, milestoneCode: null, title: 'Distribute package',
    description: 'Send package to edge nodes', assigneeId: 'operator', weight: 25, required: true
  });
  assert.deepEqual(buildProjectActionInput(getProjectActionForm('project.deliverable.review')!, {
    decision: 'accepted', comment: 'Verified'
  }, record(31, 6)), { deliverableId: 31, expectedVersion: 6, decision: 'accepted', comment: 'Verified' });
});

test('injects fixed record ids and versions for no-input and comment actions', () => {
  assert.deepEqual(buildProjectActionInput(getProjectActionForm('project.activate')!, {}, record(9, 2)), {
    projectId: 9, expectedVersion: 2
  });
  assert.deepEqual(buildProjectActionInput(getProjectActionForm('project.task.progress')!, { note: '40 percent complete' }, record(12, 3)), {
    taskId: 12, expectedVersion: 3, note: '40 percent complete'
  });
  assert.deepEqual(buildProjectActionInput(getProjectActionForm('project.risk.close')!, { comment: 'Resolved' }, record(5, 7)), {
    riskId: 5, expectedVersion: 7, comment: 'Resolved'
  });
});

test('prefills update fields from records and uses safe create defaults', () => {
  const project = record(1, 2, {
    name: 'Existing', manager_id: 'dispatcher',
    planned_start_at: '2026-09-01', planned_end_at: '2026-12-31'
  });
  assert.deepEqual(getProjectActionInitialValues(getProjectActionForm('project.update')!, project), {
    name: 'Existing', managerId: 'dispatcher',
    plannedStartAt: '2026-09-01', plannedEndAt: '2026-12-31'
  });
  assert.deepEqual(getProjectActionInitialValues(getProjectActionForm('project.task.update')!, record(2, 3, {
    milestone_code: null, title: 'Task', description: 'Details', assignee_id: 'operator', weight: 30, required: true
  })), {
    milestoneCode: '', title: 'Task', description: 'Details', assigneeId: 'operator', weight: '30', required: true
  });
  assert.deepEqual(getProjectActionInitialValues(getProjectActionForm('project.create')!), {
    name: '', managerId: 'dispatcher', plannedStartAt: '', plannedEndAt: ''
  });
});

test('rejects invalid or unexpected form values without echoing them', () => {
  const definition = getProjectActionForm('project.task.create')!;
  for (const values of [
    { milestoneCode:'',title:'T',description:'D',assigneeId:'operator',weight:'0',required:true },
    { milestoneCode:'',title:'T',description:'D',assigneeId:'operator',weight:'abc',required:true },
    { milestoneCode:'',title:'T',description:'D',assigneeId:'operator',weight:'10',required:'maybe' },
    { milestoneCode:'',title:'T',description:'D',assigneeId:'operator',weight:'10',required:true,secret:'do-not-echo' }
  ]) assert.throws(() => buildProjectActionInput(definition, values as any, record()), (error: Error) => !error.message.includes('do-not-echo'));
  assert.throws(() => buildProjectActionInput(getProjectActionForm('project.create')!, {
    name:'X',managerId:'dispatcher',plannedStartAt:'2026-02-30',plannedEndAt:'2026-12-31'
  }), /form input/i);
  assert.throws(() => buildProjectActionInput(getProjectActionForm('project.activate')!, {}), /record/i);
});
