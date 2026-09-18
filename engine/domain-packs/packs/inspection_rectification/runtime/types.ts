import type { DatabaseSync } from 'node:sqlite';

export type InspectionTaskStatus = 'pending' | 'executing' | 'pending_review' | 'archived';
export type InspectionItemResult = 'pending' | 'normal' | 'abnormal';

export interface InspectionActor {
  readonly userId: number;
  readonly username: string;
  readonly displayName: string;
  readonly roleId: string;
}

export interface InspectionAuditEntry {
  readonly actor: InspectionActor;
  readonly permission: string;
  readonly entityId: 'inspection_plan' | 'inspection_task' | 'inspection_item';
  readonly recordId: number;
  readonly result: 'success';
  readonly details: Readonly<Record<string, unknown>>;
}

export interface InspectionArchiveBlockerResult {
  readonly blocked: boolean;
  readonly code: string;
  readonly message: string;
}

export type InspectionArchiveBlocker = (
  taskId: number,
  connection: DatabaseSync
) => InspectionArchiveBlockerResult;

export interface InspectionContext {
  readonly connection: DatabaseSync;
  readonly actor: InspectionActor;
  readonly requirePermission: (actor: InspectionActor, permission: string) => void;
  readonly appendAudit: (connection: DatabaseSync, entry: InspectionAuditEntry) => void;
  readonly identityHasRole: (
    identityId: string,
    roleId: string,
    connection: DatabaseSync
  ) => boolean;
  readonly archiveBlockers: readonly InspectionArchiveBlocker[];
  readonly now: () => Date;
  readonly planCode: () => string;
  readonly taskCode: () => string;
  readonly itemCode: () => string;
  readonly eventCode: () => string;
}

export interface CreateInspectionPlanRequest {
  readonly name: string;
  readonly cycleDays: number;
  readonly instructions: string;
  readonly active: boolean;
}

export interface UpdateInspectionPlanRequest extends CreateInspectionPlanRequest {
  readonly planId: number;
  readonly expectedVersion: number;
}

export interface InspectionPlanResult {
  readonly planId: number;
  readonly planCode: string;
  readonly version: number;
  readonly cycleDays: number;
  readonly active: boolean;
}

export interface InspectionItemDefinition {
  readonly name: string;
  readonly standard: string;
}

export interface CreateInspectionTaskRequest {
  readonly planCode: string;
  readonly title: string;
  readonly executorId: string;
  readonly scheduledAt: string;
  readonly items: readonly InspectionItemDefinition[];
}

export interface InspectionTaskResult {
  readonly taskId: number;
  readonly taskCode: string;
  readonly status: InspectionTaskStatus;
  readonly version: number;
  readonly executorId: string;
  readonly startedAt: string | null;
  readonly submittedAt: string | null;
  readonly archivedAt: string | null;
  readonly itemIds: readonly number[];
}

export interface AssignInspectionExecutorRequest {
  readonly taskId: number;
  readonly expectedTaskVersion: number;
  readonly executorId: string;
  readonly reason: string;
}

export interface StartInspectionTaskRequest {
  readonly taskId: number;
  readonly expectedTaskVersion: number;
}

export interface RecordInspectionItemRequest {
  readonly taskId: number;
  readonly itemId: number;
  readonly expectedTaskVersion: number;
  readonly expectedItemVersion: number;
  readonly result: 'normal' | 'abnormal';
  readonly finding: string | null;
  readonly disposition: string | null;
}

export interface InspectionItemUpdateResult {
  readonly taskId: number;
  readonly itemId: number;
  readonly taskVersion: number;
  readonly itemVersion: number;
  readonly result: 'normal' | 'abnormal';
}

export interface SubmitInspectionReviewRequest {
  readonly taskId: number;
  readonly expectedTaskVersion: number;
}

export interface RejectInspectionReviewRequest {
  readonly taskId: number;
  readonly expectedTaskVersion: number;
  readonly reason: string;
}

export interface ArchiveInspectionTaskRequest {
  readonly taskId: number;
  readonly expectedTaskVersion: number;
  readonly comment: string;
}

export interface InspectionTaskSummary {
  readonly total: number;
  readonly pending: number;
  readonly normal: number;
  readonly abnormal: number;
}

export interface InspectionDashboardSummary {
  readonly total: number;
  readonly pending: number;
  readonly executing: number;
  readonly pendingReview: number;
  readonly archived: number;
  readonly abnormalItems: number;
}
