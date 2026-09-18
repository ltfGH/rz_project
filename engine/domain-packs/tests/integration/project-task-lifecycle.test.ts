import test from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import { ProjectService } from '../../packs/project_task/runtime/project-service';
import { createProjectRuntime, manager, member, projectContext } from '../helpers/project-runtime';

function activeProject(t: test.TestContext) {
  const runtime = createProjectRuntime(t);
  const service = new ProjectService();
  let project = runtime.database.transaction((connection) => service.createProject({
    name:'任务项目', managerId:manager.username, plannedStartAt:'2026-09-01', plannedEndAt:'2026-12-31'
  }, projectContext(connection, manager)));
  project = runtime.database.transaction((connection) => service.activateProject({
    projectId:project.projectId, expectedVersion:project.version
  }, projectContext(connection, manager)));
  return { ...runtime, service, project };
}

test('executes task reject, rework and approval with events and weighted progress', (t) => {
  const runtime = activeProject(t);
  const audits: string[] = [];
  const context = (connection:any, actor:any) => projectContext(connection, actor, {
    appendAudit:(_connection, entry) => audits.push(entry.permission)
  });
  let task = runtime.database.transaction((connection) => runtime.service.createTask({
    projectId:runtime.project.projectId, milestoneCode:null, title:'完成部署', description:'离线部署',
    assigneeId:member.username, weight:40, required:true
  }, context(connection, manager)));
  assert.deepEqual({ status:task.status, version:task.version, progress:task.projectProgress }, { status:'pending', version:1, progress:0 });
  task = runtime.database.transaction((connection) => runtime.service.startTask({ taskId:task.taskId, expectedVersion:task.version }, context(connection, member)));
  task = runtime.database.transaction((connection) => runtime.service.addTaskProgress({ taskId:task.taskId, expectedVersion:task.version, note:'已安装' }, context(connection, member)));
  task = runtime.database.transaction((connection) => runtime.service.submitTaskReview({ taskId:task.taskId, expectedVersion:task.version }, context(connection, member)));
  task = runtime.database.transaction((connection) => runtime.service.rejectTaskReview({ taskId:task.taskId, expectedVersion:task.version, reason:'补充验证' }, context(connection, manager)));
  task = runtime.database.transaction((connection) => runtime.service.addTaskProgress({ taskId:task.taskId, expectedVersion:task.version, note:'验证已补充' }, context(connection, member)));
  task = runtime.database.transaction((connection) => runtime.service.submitTaskReview({ taskId:task.taskId, expectedVersion:task.version }, context(connection, member)));
  task = runtime.database.transaction((connection) => runtime.service.approveTask({ taskId:task.taskId, expectedVersion:task.version, comment:'验收通过' }, context(connection, manager)));
  assert.deepEqual({ status:task.status, version:task.version, progress:task.projectProgress }, { status:'completed', version:8, progress:100 });
  assert.equal(task.projectVersion, 4);
  const counts = runtime.database.prepare('SELECT (SELECT COUNT(*) FROM biz_project_event) events,(SELECT progress FROM biz_project WHERE id=?) progress').get(runtime.project.projectId) as Record<string,number>;
  assert.deepEqual({ ...counts }, { events:10, progress:100 });
  assert.deepEqual(audits, [
    'project_tasks.create_task','project_tasks.start','project_tasks.add_progress','project_tasks.submit',
    'project_tasks.reject','project_tasks.add_progress','project_tasks.submit','project_tasks.approve'
  ]);
});

test('rejects invalid task inputs, ownership, self-review, state and version', (t) => {
  const runtime = activeProject(t);
  const create = (overrides:Record<string,unknown> = {}) => runtime.database.transaction((connection) => runtime.service.createTask({
    projectId:runtime.project.projectId, milestoneCode:null, title:'任务', description:'说明',
    assigneeId:member.username, weight:10, required:true, ...overrides
  } as any, projectContext(connection, manager)));
  assert.throws(() => create({ assigneeId:'missing-member' }), hasCode('VALIDATION_FAILED'));
  assert.throws(() => create({ weight:0 }), hasCode('VALIDATION_FAILED'));
  let task = create();
  assert.throws(() => runtime.database.transaction((connection) => runtime.service.startTask({ taskId:task.taskId, expectedVersion:task.version }, projectContext(connection, manager))), hasCode('PERMISSION_DENIED'));
  task = runtime.database.transaction((connection) => runtime.service.startTask({ taskId:task.taskId, expectedVersion:task.version }, projectContext(connection, member)));
  assert.throws(() => runtime.database.transaction((connection) => runtime.service.addTaskProgress({ taskId:task.taskId, expectedVersion:task.version, note:' ' }, projectContext(connection, member))), hasCode('VALIDATION_FAILED'));
  assert.throws(() => runtime.database.transaction((connection) => runtime.service.submitTaskReview({ taskId:task.taskId, expectedVersion:99 }, projectContext(connection, member))), hasCode('VERSION_CONFLICT'));

  const selfReview = activeProject(t);
  const multiRole = (identityId:string, roleId:string) => identityId === manager.username && (roleId === 'project_manager' || roleId === 'project_member');
  let ownTask = selfReview.database.transaction((connection) => selfReview.service.createTask({
    projectId:selfReview.project.projectId, milestoneCode:null, title:'经理任务', description:'说明', assigneeId:manager.username, weight:10, required:true
  }, projectContext(connection, manager, { identityHasRole:multiRole })));
  ownTask = selfReview.database.transaction((connection) => selfReview.service.startTask({ taskId:ownTask.taskId, expectedVersion:1 }, projectContext(connection, manager, { identityHasRole:multiRole })));
  ownTask = selfReview.database.transaction((connection) => selfReview.service.submitTaskReview({ taskId:ownTask.taskId, expectedVersion:2 }, projectContext(connection, manager, { identityHasRole:multiRole })));
  assert.throws(() => selfReview.database.transaction((connection) => selfReview.service.approveTask({ taskId:ownTask.taskId, expectedVersion:3, comment:'自审' }, projectContext(connection, manager, { identityHasRole:multiRole }))), hasCode('PERMISSION_DENIED'));
});

test('rolls back task completion, project progress and event when audit fails', (t) => {
  const runtime = activeProject(t);
  let task = runtime.database.transaction((connection) => runtime.service.createTask({
    projectId:runtime.project.projectId, milestoneCode:null, title:'回滚任务', description:'说明', assigneeId:member.username, weight:100, required:true
  }, projectContext(connection, manager)));
  task = runtime.database.transaction((connection) => runtime.service.startTask({ taskId:task.taskId, expectedVersion:1 }, projectContext(connection, member)));
  task = runtime.database.transaction((connection) => runtime.service.submitTaskReview({ taskId:task.taskId, expectedVersion:2 }, projectContext(connection, member)));
  const beforeEvents = (runtime.database.prepare('SELECT COUNT(*) count FROM biz_project_event').get() as {count:number}).count;
  assert.throws(() => runtime.database.transaction((connection) => runtime.service.approveTask({
    taskId:task.taskId, expectedVersion:3, comment:'通过'
  }, projectContext(connection, manager, { appendAudit:() => { throw new Error('audit failed'); } }))), /audit failed/);
  const row = runtime.database.prepare('SELECT t.status,t.version,p.progress FROM biz_project_task t JOIN biz_project p ON p.code=t.project_code WHERE t.id=?').get(task.taskId) as Record<string,unknown>;
  assert.deepEqual({ ...row }, { status:'pending_review', version:3, progress:0 });
  assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_project_event').get() as {count:number}).count, beforeEvents);
});

function hasCode(expected:string) {
  return (error:unknown) => error instanceof AppError && error.code === expected;
}
