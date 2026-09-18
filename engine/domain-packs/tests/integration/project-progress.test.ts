import test from 'node:test';
import assert from 'node:assert/strict';

import { ProjectService } from '../../packs/project_task/runtime/project-service';
import { createProjectRuntime, manager, member, projectContext } from '../helpers/project-runtime';

test('derives project progress from completed non-cancelled task weights', (t) => {
  const runtime = createProjectRuntime(t);
  const service = new ProjectService();
  let project = runtime.database.transaction((connection) => service.createProject({
    name:'进度项目', managerId:manager.username, plannedStartAt:'2026-09-01', plannedEndAt:'2026-12-31'
  }, projectContext(connection, manager)));
  project = runtime.database.transaction((connection) => service.activateProject({ projectId:project.projectId, expectedVersion:1 }, projectContext(connection, manager)));
  const create = (title:string, weight:number) => runtime.database.transaction((connection) => service.createTask({
    projectId:project.projectId, milestoneCode:null, title, description:'说明', assigneeId:member.username, weight, required:true
  }, projectContext(connection, manager)));
  let thirty = create('三成任务', 30);
  let seventy = create('七成任务', 70);
  thirty = runtime.database.transaction((connection) => service.startTask({ taskId:thirty.taskId, expectedVersion:1 }, projectContext(connection, member)));
  thirty = runtime.database.transaction((connection) => service.submitTaskReview({ taskId:thirty.taskId, expectedVersion:2 }, projectContext(connection, member)));
  thirty = runtime.database.transaction((connection) => service.approveTask({ taskId:thirty.taskId, expectedVersion:3, comment:'通过' }, projectContext(connection, manager)));
  assert.equal(thirty.projectProgress, 30);
  seventy = runtime.database.transaction((connection) => service.cancelTask({ taskId:seventy.taskId, expectedVersion:1, reason:'范围调整' }, projectContext(connection, manager)));
  assert.equal(seventy.projectProgress, 100);
  seventy = runtime.database.transaction((connection) => service.restoreTask({ taskId:seventy.taskId, expectedVersion:2, reason:'恢复范围' }, projectContext(connection, manager)));
  assert.equal(seventy.projectProgress, 30);
  seventy = runtime.database.transaction((connection) => service.updatePendingTask({
    taskId:seventy.taskId, expectedVersion:3, milestoneCode:null, title:'两成任务', description:'调整权重', assigneeId:member.username, weight:20, required:true
  }, projectContext(connection, manager)));
  assert.equal(seventy.projectProgress, 60);
  assert.equal(seventy.projectVersion, 8);
  assert.equal((runtime.database.prepare('SELECT progress FROM biz_project WHERE id=?').get(project.projectId) as {progress:number}).progress, 60);
});

test('keeps zero progress when every effective task is cancelled', (t) => {
  const runtime = createProjectRuntime(t);
  const service = new ProjectService();
  let project = runtime.database.transaction((connection) => service.createProject({
    name:'空进度项目', managerId:manager.username, plannedStartAt:'2026-09-01', plannedEndAt:'2026-12-31'
  }, projectContext(connection, manager)));
  project = runtime.database.transaction((connection) => service.activateProject({ projectId:project.projectId, expectedVersion:1 }, projectContext(connection, manager)));
  let task = runtime.database.transaction((connection) => service.createTask({
    projectId:project.projectId, milestoneCode:null, title:'取消任务', description:'说明', assigneeId:member.username, weight:25, required:false
  }, projectContext(connection, manager)));
  task = runtime.database.transaction((connection) => service.cancelTask({ taskId:task.taskId, expectedVersion:1, reason:'取消' }, projectContext(connection, manager)));
  assert.equal(task.projectProgress, 0);
});
