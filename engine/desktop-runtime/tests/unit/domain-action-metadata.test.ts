import test from 'node:test';
import assert from 'node:assert/strict';

import { collectDomainActionMetadata } from '../../src/main/domain-action-metadata';

test('projects authorized module and record actions with explicit scope', () => {
  const uiExtensions = {
    module: { value: { slot: 'entity.module.actions', entityId: 'project', label: '项目操作', order: 10, actionIds: ['project.create'] } },
    record: { value: { slot: 'entity.detail.actions', entityId: 'project', label: '项目操作', order: 20, actionIds: ['project.update'] } },
    ignored: { value: { slot: 'dashboard.sections', label: '概览', actionIds: ['project.dashboard_summary'] } }
  };
  const domainActions = {
    create: { value: { permission: 'projects.create_project' } },
    update: { value: { permission: 'projects.update_project' } }
  };
  const byId = {
    'project.create': domainActions.create,
    'project.update': domainActions.update
  };

  const result = collectDomainActionMetadata(uiExtensions as any, byId as any, (permission) => (
    permission === 'projects.create_project' || permission === 'projects.update_project'
  ));

  assert.deepEqual(result, [
    { id: 'project.create', entityId: 'project', label: '项目操作', order: 10, scope: 'module' },
    { id: 'project.update', entityId: 'project', label: '项目操作', order: 20, scope: 'record' }
  ]);
});

test('omits unauthorized unknown and unsupported-slot actions', () => {
  const result = collectDomainActionMetadata({
    denied: { value: { slot: 'entity.module.actions', entityId: 'project', actionIds: ['project.create'] } },
    unknown: { value: { slot: 'entity.detail.actions', entityId: 'project', actionIds: ['project.missing'] } },
    unsupported: { value: { slot: 'other.actions', entityId: 'project', actionIds: ['project.update'] } }
  } as any, {
    create: { value: { permission: 'projects.create_project' } },
    update: { value: { permission: 'projects.update_project' } },
    'project.create': { value: { permission: 'projects.create_project' } },
    'project.update': { value: { permission: 'projects.update_project' } }
  } as any, () => false);
  assert.deepEqual(result, []);
});
