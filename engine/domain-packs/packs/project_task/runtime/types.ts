import type { DatabaseSync } from 'node:sqlite';

export interface ProjectActor {
  readonly userId: number;
  readonly username: string;
  readonly displayName: string;
  readonly roleId: string;
}

export interface ProjectAuditEntry {
  readonly actor: ProjectActor;
  readonly permission: string;
  readonly entityId: 'project' | 'milestone' | 'project_task' | 'project_risk' | 'deliverable';
  readonly recordId: number;
  readonly result: 'success';
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ProjectCloseBlockerResult {
  readonly blocked: boolean;
  readonly code: string;
  readonly message: string;
}

export interface ProjectReadConnection {
  find(entityId: string, equalityFilters: Readonly<Record<string, string | number | null>>): readonly Readonly<Record<string, unknown>>[];
}

export type ProjectCloseBlocker = (projectId: number, connection: ProjectReadConnection) => ProjectCloseBlockerResult;

export interface ProjectContext {
  readonly connection: DatabaseSync;
  readonly actor: ProjectActor;
  readonly requirePermission: (actor: ProjectActor, permission: string) => void;
  readonly appendAudit: (connection: DatabaseSync, entry: ProjectAuditEntry) => void;
  readonly identityHasRole: (identityId: string, roleId: string, connection: DatabaseSync) => boolean;
  readonly closeBlockers: readonly ProjectCloseBlocker[];
  readonly now: () => Date;
  readonly projectCode: () => string;
  readonly milestoneCode: () => string;
  readonly taskCode: () => string;
  readonly riskCode: () => string;
  readonly deliverableCode: () => string;
  readonly eventCode: () => string;
}

export interface CreateProjectRequest {
  readonly name: string;
  readonly managerId: string;
  readonly plannedStartAt: string;
  readonly plannedEndAt: string;
}

export interface UpdateProjectRequest extends CreateProjectRequest {
  readonly projectId: number;
  readonly expectedVersion: number;
}

export interface ActivateProjectRequest {
  readonly projectId: number;
  readonly expectedVersion: number;
}

export interface ProjectResult {
  readonly projectId: number;
  readonly projectCode: string;
  readonly status: 'planning' | 'active' | 'pending_close' | 'closed';
  readonly progress: number;
  readonly version: number;
}

export interface CreateMilestoneRequest {
  readonly projectId: number;
  readonly name: string;
  readonly dueAt: string;
}

export interface MilestoneResult {
  readonly milestoneId: number;
  readonly milestoneCode: string;
  readonly projectCode: string;
  readonly status: 'pending' | 'completed';
  readonly version: number;
}
