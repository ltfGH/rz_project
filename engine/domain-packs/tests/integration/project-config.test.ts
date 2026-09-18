import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { ProjectService } from '../../packs/project_task/runtime/project-service';
import { admin, createProjectRuntime, manager, manager2, member, projectContext } from '../helpers/project-runtime';

test('creates, updates and activates a project before adding a milestone', (t) => {
  const runtime = createProjectRuntime(t);
  const service = new ProjectService();
  const audits: string[] = [];
  const context = (connection: any, actor = manager) => projectContext(connection, actor, {
    appendAudit: (_connection, entry) => audits.push(entry.permission)
  });

  let project = runtime.database.transaction((connection) => service.createProject({
    name: '验收项目', managerId: manager.username,
    plannedStartAt: '2026-09-20', plannedEndAt: '2026-12-31'
  }, context(connection)));
  assert.deepEqual(project, { projectId:1, projectCode:project.projectCode, status:'planning', progress:0, version:1 });

  project = runtime.database.transaction((connection) => service.updateProject({
    projectId: project.projectId, expectedVersion:1, name:'更新后的验收项目',
    managerId: manager2.username, plannedStartAt:'2026-09-21', plannedEndAt:'2027-01-15'
  }, context(connection, admin)));
  assert.equal(project.version, 2);

  project = runtime.database.transaction((connection) => service.activateProject({
    projectId:project.projectId, expectedVersion:2
  }, context(connection, manager2)));
  assert.deepEqual({ status:project.status, version:project.version }, { status:'active', version:3 });

  const milestone = runtime.database.transaction((connection) => service.createMilestone({
    projectId:project.projectId, name:'首阶段交付', dueAt:'2026-11-30'
  }, context(connection, manager2)));
  assert.deepEqual({ status:milestone.status, version:milestone.version }, { status:'pending', version:1 });
  assert.deepEqual(audits, [
    'projects.create_project', 'projects.update_project', 'projects.activate', 'milestones.create_milestone'
  ]);
  const counts = runtime.database.prepare(
    'SELECT (SELECT COUNT(*) FROM biz_project) projects,(SELECT COUNT(*) FROM biz_milestone) milestones,(SELECT COUNT(*) FROM biz_project_event) events'
  ).get() as Record<string, number>;
  assert.deepEqual({ ...counts }, { projects:1, milestones:1, events:4 });
});

test('rejects invalid dates, identities, permissions, states and versions', (t) => {
  const runtime = createProjectRuntime(t);
  const service = new ProjectService();
  const create = (overrides: Record<string, unknown> = {}, actor = manager) => runtime.database.transaction((connection) => service.createProject({
    name:'项目', managerId:manager.username, plannedStartAt:'2026-09-20', plannedEndAt:'2026-12-31', ...overrides
  } as any, projectContext(connection, actor)));

  assert.throws(() => create({ plannedStartAt:'2026-02-30' }), hasCode('VALIDATION_FAILED'));
  assert.throws(() => create({ plannedStartAt:'2027-01-01' }), hasCode('VALIDATION_FAILED'));
  assert.throws(() => create({ managerId:member.username }), hasCode('VALIDATION_FAILED'));
  assert.throws(() => create({}, member), hasCode('PERMISSION_DENIED'));
  assert.throws(() => runtime.database.transaction((connection) => service.createProject({
    name:'无权限', managerId:manager.username, plannedStartAt:'2026-09-20', plannedEndAt:'2026-12-31'
  }, projectContext(connection, manager, { requirePermission:() => { throw new AppError('PERMISSION_DENIED', 'denied'); } }))), hasCode('PERMISSION_DENIED'));

  let project = create();
  assert.throws(() => runtime.database.transaction((connection) => service.updateProject({
    projectId:project.projectId, expectedVersion:99, name:'过期', managerId:manager.username,
    plannedStartAt:'2026-09-20', plannedEndAt:'2026-12-31'
  }, projectContext(connection, manager))), hasCode('VERSION_CONFLICT'));
  project = runtime.database.transaction((connection) => service.activateProject({ projectId:project.projectId, expectedVersion:1 }, projectContext(connection, manager)));
  assert.throws(() => runtime.database.transaction((connection) => service.updateProject({
    projectId:project.projectId, expectedVersion:project.version, name:'已激活修改', managerId:manager.username,
    plannedStartAt:'2026-09-20', plannedEndAt:'2026-12-31'
  }, projectContext(connection, manager))), hasCode('INVALID_TRANSITION'));
  assert.throws(() => runtime.database.transaction((connection) => service.createMilestone({
    projectId:project.projectId, name:'越界里程碑', dueAt:'2027-01-01'
  }, projectContext(connection, manager))), hasCode('VALIDATION_FAILED'));
});

test('blocks generic writes for every project entity and rolls back a late audit failure', (t) => {
  const runtime = createProjectRuntime(t);
  const service = new ProjectService();
  for (const entity of ['project','milestone','project_task','project_risk','deliverable','project_event']) {
    assert.throws(() => runtime.repository.create(entity, {}, admin), hasCode('PERMISSION_DENIED'));
  }
  assert.throws(() => runtime.database.transaction((connection) => service.createProject({
    name:'回滚项目', managerId:manager.username, plannedStartAt:'2026-09-20', plannedEndAt:'2026-12-31'
  }, projectContext(connection, manager, { appendAudit:() => { throw new Error('audit failed'); } }))), /audit failed/);
  const counts = runtime.database.prepare(
    'SELECT (SELECT COUNT(*) FROM biz_project) projects,(SELECT COUNT(*) FROM biz_project_event) events'
  ).get() as Record<string, number>;
  assert.deepEqual({ ...counts }, { projects:0, events:0 });
});

function hasCode(expected: string) {
  return (error: unknown) => error instanceof AppError && error.code === expected;
}
