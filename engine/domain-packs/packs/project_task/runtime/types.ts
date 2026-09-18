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

export interface CreateTaskRequest {
  readonly projectId: number;
  readonly milestoneCode: string | null;
  readonly title: string;
  readonly description: string;
  readonly assigneeId: string;
  readonly weight: number;
  readonly required: boolean;
}

export interface UpdatePendingTaskRequest extends Omit<CreateTaskRequest, 'projectId'> {
  readonly taskId: number;
  readonly expectedVersion: number;
}

export interface VersionedTaskRequest {
  readonly taskId: number;
  readonly expectedVersion: number;
}

export interface AddTaskProgressRequest extends VersionedTaskRequest { readonly note: string; }
export interface RejectTaskReviewRequest extends VersionedTaskRequest { readonly reason: string; }
export interface ApproveTaskRequest extends VersionedTaskRequest { readonly comment: string; }
export interface CancelTaskRequest extends VersionedTaskRequest { readonly reason: string; }
export interface RestoreTaskRequest extends VersionedTaskRequest { readonly reason: string; }

export interface TaskResult {
  readonly taskId: number;
  readonly taskCode: string;
  readonly projectCode: string;
  readonly status: 'pending' | 'in_progress' | 'pending_review' | 'completed' | 'cancelled';
  readonly version: number;
  readonly projectProgress: number;
  readonly projectVersion: number;
}

export interface CreateRiskRequest { readonly projectId:number; readonly title:string; readonly description:string; readonly level:'low'|'medium'|'high'; }
export interface MitigateRiskRequest { readonly riskId:number; readonly expectedVersion:number; readonly disposition:string; }
export interface CloseRiskRequest { readonly riskId:number; readonly expectedVersion:number; readonly comment:string; }
export interface ReopenRiskRequest { readonly riskId:number; readonly expectedVersion:number; readonly reason:string; }
export interface RiskResult { readonly riskId:number; readonly riskCode:string; readonly projectCode:string; readonly status:'open'|'mitigated'|'closed'; readonly version:number; }

export interface SubmitDeliverableRequest { readonly projectId:number; readonly milestoneCode:string|null; readonly deliverableKey:string; readonly name:string; readonly businessVersion:string; readonly required:boolean; readonly fileName:string; readonly fileDigest:string; }
export interface ReviewDeliverableRequest { readonly deliverableId:number; readonly expectedVersion:number; readonly decision:'accepted'|'rejected'; readonly comment:string; }
export interface DeliverableResult { readonly deliverableId:number; readonly deliverableCode:string; readonly projectCode:string; readonly status:'submitted'|'accepted'|'rejected'; readonly version:number; }

export interface CompleteMilestoneRequest { readonly milestoneId:number; readonly expectedVersion:number; readonly comment:string; }
