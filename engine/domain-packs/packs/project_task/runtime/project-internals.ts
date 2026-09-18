import { AppError } from '../../../../desktop-runtime/src/shared/errors';
import type { ProjectContext, ProjectResult } from './types';

export type ProjectRow = {
  id: number;
  code: string;
  name: string;
  manager_id: string;
  status: ProjectResult['status'];
  planned_start_at: string;
  planned_end_at: string;
  progress: number;
  version: number;
};

export function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} is required.`, { fieldErrors:[{ field, message:'Required.' }] });
  return normalized;
}

export function strictDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('VALIDATION_FAILED', `${field} is invalid.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new AppError('VALIDATION_FAILED', `${field} is invalid.`);
  return value;
}

export function readProject(projectId: number, context: ProjectContext): ProjectRow {
  const row = context.connection.prepare(
    'SELECT id,code,name,manager_id,status,planned_start_at,planned_end_at,progress,version FROM biz_project WHERE id=?'
  ).get(projectId) as ProjectRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Project not found.');
  return row;
}

export function hasRole(context: ProjectContext, roleId: string): boolean {
  return context.identityHasRole(context.actor.username, roleId, context.connection);
}

export function assertProjectCreator(context: ProjectContext, managerId: string): void {
  const isAdmin = hasRole(context, 'project_admin');
  const isManager = hasRole(context, 'project_manager');
  if (!isAdmin && !isManager) throw new AppError('PERMISSION_DENIED', 'Current identity cannot create projects.');
  if (!context.identityHasRole(managerId, 'project_manager', context.connection)) throw new AppError('VALIDATION_FAILED', 'Project manager identity is invalid.');
  if (!isAdmin && context.actor.username !== managerId) throw new AppError('PERMISSION_DENIED', 'A project manager can only create a self-managed project.');
}

export function assertCurrentManager(row: ProjectRow, context: ProjectContext): void {
  if (!hasRole(context, 'project_manager') || row.manager_id !== context.actor.username) throw new AppError('PERMISSION_DENIED', 'Current identity is not this project manager.');
}

export function appendProjectEvent(
  context: ProjectContext,
  projectCode: string,
  subjectType: 'project' | 'milestone' | 'task' | 'risk' | 'deliverable',
  subjectCode: string,
  eventType: string,
  fromStatus: string | null,
  toStatus: string | null,
  comment: string | null
): string {
  const code = context.eventCode();
  const now = context.now().toISOString();
  context.connection.prepare(
    'INSERT INTO biz_project_event (code,project_code,subject_type,subject_code,event_type,from_status,to_status,actor_id,comment,occurred_at,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)'
  ).run(code, projectCode, subjectType, subjectCode, eventType, fromStatus, toStatus, context.actor.username, comment, now, now, now);
  return code;
}

export function projectResult(row: Pick<ProjectRow, 'id' | 'code' | 'status' | 'progress' | 'version'>): ProjectResult {
  return Object.freeze({ projectId:row.id, projectCode:row.code, status:row.status, progress:Number(row.progress), version:row.version });
}
