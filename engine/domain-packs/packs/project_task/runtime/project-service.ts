import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import {
  appendProjectEvent, assertCurrentManager, assertProjectCreator, hasRole,
  projectResult, readProject, required, strictDate
} from './project-internals';
import type {
  ActivateProjectRequest, CreateMilestoneRequest, CreateProjectRequest,
  MilestoneResult, ProjectContext, ProjectResult, UpdateProjectRequest
} from './types';

function validateProjectInput(request: CreateProjectRequest) {
  const name = required(request.name, 'name');
  const managerId = required(request.managerId, 'managerId');
  const plannedStartAt = strictDate(request.plannedStartAt, 'plannedStartAt');
  const plannedEndAt = strictDate(request.plannedEndAt, 'plannedEndAt');
  if (plannedStartAt > plannedEndAt) throw new AppError('VALIDATION_FAILED', 'Project start date must not follow end date.');
  return { name, managerId, plannedStartAt, plannedEndAt };
}

export class ProjectService {
  createProject(request: CreateProjectRequest, context: ProjectContext): ProjectResult {
    const permission = 'projects.create_project';
    context.requirePermission(context.actor, permission);
    const input = validateProjectInput(request);
    assertProjectCreator(context, input.managerId);
    const code = context.projectCode();
    const now = context.now().toISOString();
    let id: number;
    try {
      id = Number(context.connection.prepare(
        "INSERT INTO biz_project (code,name,manager_id,status,planned_start_at,planned_end_at,progress,close_requested_by,close_requested_at,closed_by,closed_at,version,created_at,updated_at) VALUES (?,?,?,'planning',?,?,0,NULL,NULL,NULL,NULL,1,?,?)"
      ).run(code, input.name, input.managerId, input.plannedStartAt, input.plannedEndAt, now, now).lastInsertRowid);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/.test(error.message)) throw new AppError('UNIQUE_CONFLICT', 'Project code already exists.');
      throw error;
    }
    const eventCode = appendProjectEvent(context, code, 'project', code, 'project_created', null, 'planning', null);
    context.appendAudit(context.connection, Object.freeze({ actor:context.actor, permission, entityId:'project', recordId:id, result:'success', details:Object.freeze({ code, eventCode }) }));
    return Object.freeze({ projectId:id, projectCode:code, status:'planning', progress:0, version:1 });
  }

  updateProject(request: UpdateProjectRequest, context: ProjectContext): ProjectResult {
    const permission = 'projects.update_project';
    context.requirePermission(context.actor, permission);
    const row = readProject(request.projectId, context);
    const isAdmin = hasRole(context, 'project_admin');
    if (!isAdmin) assertCurrentManager(row, context);
    if (row.status !== 'planning') throw new AppError('INVALID_TRANSITION', 'Only planning projects can be updated.');
    const input = validateProjectInput(request);
    if (!context.identityHasRole(input.managerId, 'project_manager', context.connection)) throw new AppError('VALIDATION_FAILED', 'Project manager identity is invalid.');
    if (!isAdmin && input.managerId !== row.manager_id) throw new AppError('PERMISSION_DENIED', 'Only a project administrator can change the manager.');
    if (row.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', 'Project version conflict.');
    const now = context.now().toISOString();
    const update = context.connection.prepare(
      'UPDATE biz_project SET name=?,manager_id=?,planned_start_at=?,planned_end_at=?,version=version+1,updated_at=? WHERE id=? AND version=?'
    ).run(input.name, input.managerId, input.plannedStartAt, input.plannedEndAt, now, row.id, request.expectedVersion);
    if (Number(update.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Project version conflict.');
    const eventCode = appendProjectEvent(context, row.code, 'project', row.code, 'project_updated', 'planning', 'planning', null);
    context.appendAudit(context.connection, Object.freeze({ actor:context.actor, permission, entityId:'project', recordId:row.id, result:'success', details:Object.freeze({ code:row.code, eventCode }) }));
    return projectResult({ ...row, status:'planning', version:row.version + 1 });
  }

  activateProject(request: ActivateProjectRequest, context: ProjectContext): ProjectResult {
    const permission = 'projects.activate';
    context.requirePermission(context.actor, permission);
    const row = readProject(request.projectId, context);
    assertCurrentManager(row, context);
    if (row.status !== 'planning') throw new AppError('INVALID_TRANSITION', 'Only planning projects can be activated.');
    if (row.version !== request.expectedVersion) throw new AppError('VERSION_CONFLICT', 'Project version conflict.');
    const now = context.now().toISOString();
    const update = context.connection.prepare(
      "UPDATE biz_project SET status='active',version=version+1,updated_at=? WHERE id=? AND version=?"
    ).run(now, row.id, request.expectedVersion);
    if (Number(update.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Project version conflict.');
    const eventCode = appendProjectEvent(context, row.code, 'project', row.code, 'project_activated', 'planning', 'active', null);
    context.appendAudit(context.connection, Object.freeze({ actor:context.actor, permission, entityId:'project', recordId:row.id, result:'success', details:Object.freeze({ code:row.code, eventCode }) }));
    return projectResult({ ...row, status:'active', version:row.version + 1 });
  }

  createMilestone(request: CreateMilestoneRequest, context: ProjectContext): MilestoneResult {
    const permission = 'milestones.create_milestone';
    context.requirePermission(context.actor, permission);
    const project = readProject(request.projectId, context);
    assertCurrentManager(project, context);
    if (project.status !== 'planning' && project.status !== 'active') throw new AppError('INVALID_TRANSITION', 'This project cannot accept milestones.');
    const name = required(request.name, 'name');
    const dueAt = strictDate(request.dueAt, 'dueAt');
    if (dueAt < project.planned_start_at || dueAt > project.planned_end_at) throw new AppError('VALIDATION_FAILED', 'Milestone due date must be within the project plan.');
    const code = context.milestoneCode();
    const now = context.now().toISOString();
    const inserted = context.connection.prepare(
      "INSERT INTO biz_milestone (code,project_code,name,due_at,status,completed_by,completed_at,version,created_at,updated_at) VALUES (?,?,?,?,'pending',NULL,NULL,1,?,?)"
    ).run(code, project.code, name, dueAt, now, now);
    const id = Number(inserted.lastInsertRowid);
    const eventCode = appendProjectEvent(context, project.code, 'milestone', code, 'milestone_created', null, 'pending', null);
    context.appendAudit(context.connection, Object.freeze({ actor:context.actor, permission, entityId:'milestone', recordId:id, result:'success', details:Object.freeze({ code, eventCode }) }));
    return Object.freeze({ milestoneId:id, milestoneCode:code, projectCode:project.code, status:'pending', version:1 });
  }
}
