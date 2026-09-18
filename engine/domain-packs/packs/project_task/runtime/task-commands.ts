import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import { appendProjectEvent, assertCurrentManager, readProject, required } from './project-internals';
import type {
  AddTaskProgressRequest, ApproveTaskRequest, CancelTaskRequest, CreateTaskRequest,
  ProjectContext, ProjectResult, RejectTaskReviewRequest, RestoreTaskRequest,
  TaskResult, UpdatePendingTaskRequest, VersionedTaskRequest
} from './types';

type TaskRow = {
  id:number; code:string; project_code:string; milestone_code:string|null; title:string;
  description:string; assignee_id:string; weight:number; required:number;
  status:TaskResult['status']; progress_note:string|null; version:number;
};

function readTask(taskId:number, context:ProjectContext):TaskRow {
  const row = context.connection.prepare(
    'SELECT id,code,project_code,milestone_code,title,description,assignee_id,weight,required,status,progress_note,version FROM biz_project_task WHERE id=?'
  ).get(taskId) as TaskRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Project task not found.');
  return row;
}

function readTaskProject(row:TaskRow, context:ProjectContext) {
  const project = context.connection.prepare(
    'SELECT id,code,name,manager_id,status,planned_start_at,planned_end_at,progress,version FROM biz_project WHERE code=?'
  ).get(row.project_code) as any;
  if (!project) throw new AppError('NOT_FOUND', 'Project not found.');
  return project as ReturnType<typeof readProject>;
}

function assertActive(status:ProjectResult['status']):void {
  if (status !== 'active') throw new AppError('INVALID_TRANSITION', 'Only active projects accept task changes.');
}

function assertAssignee(row:TaskRow, context:ProjectContext):void {
  if (!context.identityHasRole(context.actor.username, 'project_member', context.connection) || row.assignee_id !== context.actor.username) {
    throw new AppError('PERMISSION_DENIED', 'Current identity is not the task assignee.');
  }
}

function validWeight(value:number):number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AppError('VALIDATION_FAILED', 'Task weight must be a positive safe integer.');
  return value;
}

function validateMilestone(projectCode:string, milestoneCode:string|null, context:ProjectContext):void {
  if (milestoneCode === null) return;
  const row = context.connection.prepare('SELECT project_code,status FROM biz_milestone WHERE code=?').get(milestoneCode) as {project_code:string;status:string}|undefined;
  if (!row || row.project_code !== projectCode) throw new AppError('VALIDATION_FAILED', 'Task milestone is invalid.');
  if (row.status === 'completed') throw new AppError('INVALID_TRANSITION', 'Completed milestones cannot accept tasks.');
}

function validateTaskInput(request:Pick<CreateTaskRequest,'milestoneCode'|'title'|'description'|'assigneeId'|'weight'|'required'>, projectCode:string, context:ProjectContext) {
  const title = required(request.title, 'title');
  const description = required(request.description, 'description');
  const assigneeId = required(request.assigneeId, 'assigneeId');
  if (!context.identityHasRole(assigneeId, 'project_member', context.connection)) throw new AppError('VALIDATION_FAILED', 'Task assignee identity is invalid.');
  const weight = validWeight(request.weight);
  validateMilestone(projectCode, request.milestoneCode, context);
  return { title, description, assigneeId, weight, required:request.required, milestoneCode:request.milestoneCode };
}

export function recalculateProjectProgress(projectCode:string, context:ProjectContext) {
  const totals = context.connection.prepare(
    "SELECT COALESCE(SUM(weight),0) total_weight,COALESCE(SUM(CASE WHEN status='completed' THEN weight ELSE 0 END),0) completed_weight FROM biz_project_task WHERE project_code=? AND status!='cancelled'"
  ).get(projectCode) as {total_weight:number;completed_weight:number};
  const total = Number(totals.total_weight), completed = Number(totals.completed_weight);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(completed)) throw new AppError('VALIDATION_FAILED', 'Project task weights exceed the supported range.');
  const progress = total === 0 ? 0 : Math.round((completed / total) * 10_000) / 100;
  const now = context.now().toISOString();
  context.connection.prepare('UPDATE biz_project SET progress=?,version=version+1,updated_at=? WHERE code=?').run(progress, now, projectCode);
  const project = context.connection.prepare('SELECT version FROM biz_project WHERE code=?').get(projectCode) as {version:number};
  return Object.freeze({ progress, version:project.version });
}

function currentProjectState(projectCode:string, context:ProjectContext) {
  const row = context.connection.prepare('SELECT progress,version FROM biz_project WHERE code=?').get(projectCode) as {progress:number;version:number};
  return Object.freeze({ progress:Number(row.progress), version:row.version });
}

function result(row:TaskRow, state:{progress:number;version:number}, changes:Partial<Pick<TaskRow,'status'|'version'>> = {}):TaskResult {
  return Object.freeze({ taskId:row.id, taskCode:row.code, projectCode:row.project_code, status:changes.status ?? row.status, version:changes.version ?? row.version, projectProgress:state.progress, projectVersion:state.version });
}

function audit(context:ProjectContext, permission:string, row:TaskRow, eventCode:string) {
  context.appendAudit(context.connection, Object.freeze({ actor:context.actor, permission, entityId:'project_task', recordId:row.id, result:'success', details:Object.freeze({ code:row.code, eventCode }) }));
}

export function createTask(request:CreateTaskRequest, context:ProjectContext):TaskResult {
  const permission = 'project_tasks.create_task'; context.requirePermission(context.actor, permission);
  const project = readProject(request.projectId, context); assertCurrentManager(project, context); assertActive(project.status);
  const input = validateTaskInput(request, project.code, context), code = context.taskCode(), now = context.now().toISOString();
  const inserted = context.connection.prepare(
    "INSERT INTO biz_project_task (code,project_code,milestone_code,title,description,assignee_id,weight,required,status,progress_note,submitted_at,completed_at,cancelled_at,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'pending',NULL,NULL,NULL,NULL,1,?,?)"
  ).run(code, project.code, input.milestoneCode, input.title, input.description, input.assigneeId, input.weight, input.required?1:0, now, now);
  const row:TaskRow = { id:Number(inserted.lastInsertRowid), code, project_code:project.code, milestone_code:input.milestoneCode, title:input.title, description:input.description, assignee_id:input.assigneeId, weight:input.weight, required:input.required?1:0, status:'pending', progress_note:null, version:1 };
  const state = recalculateProjectProgress(project.code, context);
  const eventCode = appendProjectEvent(context, project.code, 'task', code, 'task_created', null, 'pending', null); audit(context, permission, row, eventCode);
  return result(row, state);
}

export function updatePendingTask(request:UpdatePendingTaskRequest, context:ProjectContext):TaskResult {
  const permission='project_tasks.update_task'; context.requirePermission(context.actor, permission);
  const row=readTask(request.taskId,context), project=readTaskProject(row,context); assertCurrentManager(project,context); assertActive(project.status);
  if(row.status!=='pending')throw new AppError('INVALID_TRANSITION','Only pending tasks can be updated.');
  const input=validateTaskInput(request,project.code,context); if(row.version!==request.expectedVersion)throw new AppError('VERSION_CONFLICT','Task version conflict.');
  const now=context.now().toISOString(); const update=context.connection.prepare('UPDATE biz_project_task SET milestone_code=?,title=?,description=?,assignee_id=?,weight=?,required=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(input.milestoneCode,input.title,input.description,input.assigneeId,input.weight,input.required?1:0,now,row.id,request.expectedVersion);
  if(Number(update.changes)!==1)throw new AppError('VERSION_CONFLICT','Task version conflict.'); const state=recalculateProjectProgress(project.code,context);
  const eventCode=appendProjectEvent(context,project.code,'task',row.code,'task_updated','pending','pending',null); audit(context,permission,row,eventCode); return result(row,state,{version:row.version+1});
}

function transition(row:TaskRow, context:ProjectContext, expectedVersion:number, permission:string, eventType:string, from:TaskResult['status'], to:TaskResult['status'], comment:string|null, extraSql:string, extraValues:Array<string|number|null>, recalculate:boolean):TaskResult {
  if(row.status!==from)throw new AppError('INVALID_TRANSITION',`Task must be ${from}.`); if(row.version!==expectedVersion)throw new AppError('VERSION_CONFLICT','Task version conflict.');
  const now=context.now().toISOString(); const update=context.connection.prepare(`UPDATE biz_project_task SET status=?,${extraSql}version=version+1,updated_at=? WHERE id=? AND version=?`).run(to,...extraValues,now,row.id,expectedVersion);
  if(Number(update.changes)!==1)throw new AppError('VERSION_CONFLICT','Task version conflict.'); const state=recalculate?recalculateProjectProgress(row.project_code,context):currentProjectState(row.project_code,context);
  const eventCode=appendProjectEvent(context,row.project_code,'task',row.code,eventType,from,to,comment); audit(context,permission,row,eventCode); return result(row,state,{status:to,version:row.version+1});
}

export function startTask(request:VersionedTaskRequest,context:ProjectContext):TaskResult {const permission='project_tasks.start';context.requirePermission(context.actor,permission);const row=readTask(request.taskId,context),project=readTaskProject(row,context);assertAssignee(row,context);assertActive(project.status);return transition(row,context,request.expectedVersion,permission,'task_started','pending','in_progress',null,'',[],false);}
export function addTaskProgress(request:AddTaskProgressRequest,context:ProjectContext):TaskResult {const permission='project_tasks.add_progress';context.requirePermission(context.actor,permission);const row=readTask(request.taskId,context),project=readTaskProject(row,context);assertAssignee(row,context);assertActive(project.status);const note=required(request.note,'note');return transition(row,context,request.expectedVersion,permission,'task_progress_added','in_progress','in_progress',note,'progress_note=?,',[note],false);}
export function submitTaskReview(request:VersionedTaskRequest,context:ProjectContext):TaskResult {const permission='project_tasks.submit';context.requirePermission(context.actor,permission);const row=readTask(request.taskId,context),project=readTaskProject(row,context);assertAssignee(row,context);assertActive(project.status);return transition(row,context,request.expectedVersion,permission,'task_submitted','in_progress','pending_review',null,'submitted_at=?,',[context.now().toISOString()],false);}
export function rejectTaskReview(request:RejectTaskReviewRequest,context:ProjectContext):TaskResult {const permission='project_tasks.reject';context.requirePermission(context.actor,permission);const row=readTask(request.taskId,context),project=readTaskProject(row,context);assertCurrentManager(project,context);assertActive(project.status);if(row.assignee_id===context.actor.username)throw new AppError('PERMISSION_DENIED','Task assignee cannot review the same task.');const reason=required(request.reason,'reason');return transition(row,context,request.expectedVersion,permission,'task_rejected','pending_review','in_progress',reason,'submitted_at=NULL,',[],false);}
export function approveTask(request:ApproveTaskRequest,context:ProjectContext):TaskResult {const permission='project_tasks.approve';context.requirePermission(context.actor,permission);const row=readTask(request.taskId,context),project=readTaskProject(row,context);assertCurrentManager(project,context);assertActive(project.status);if(row.assignee_id===context.actor.username)throw new AppError('PERMISSION_DENIED','Task assignee cannot review the same task.');const comment=required(request.comment,'comment');return transition(row,context,request.expectedVersion,permission,'task_completed','pending_review','completed',comment,'completed_at=?,',[context.now().toISOString()],true);}
export function cancelTask(request:CancelTaskRequest,context:ProjectContext):TaskResult {const permission='project_tasks.cancel';context.requirePermission(context.actor,permission);const row=readTask(request.taskId,context),project=readTaskProject(row,context);assertCurrentManager(project,context);assertActive(project.status);if(row.status==='completed'||row.status==='cancelled')throw new AppError('INVALID_TRANSITION','Task cannot be cancelled.');const reason=required(request.reason,'reason');return transition(row,context,request.expectedVersion,permission,'task_cancelled',row.status,'cancelled',reason,'cancelled_at=?,',[context.now().toISOString()],true);}
export function restoreTask(request:RestoreTaskRequest,context:ProjectContext):TaskResult {const permission='project_tasks.restore';context.requirePermission(context.actor,permission);const row=readTask(request.taskId,context),project=readTaskProject(row,context);assertCurrentManager(project,context);assertActive(project.status);const reason=required(request.reason,'reason');return transition(row,context,request.expectedVersion,permission,'task_restored','cancelled','pending',reason,'cancelled_at=NULL,submitted_at=NULL,completed_at=NULL,',[],true);}
