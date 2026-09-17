import type { DatabaseSync } from 'node:sqlite';

export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';
export type WorkOrderStatus =
  | 'pending_dispatch'
  | 'pending_acceptance'
  | 'processing'
  | 'pending_review'
  | 'closed';

export interface WorkOrderActor {
  readonly userId: number;
  readonly username: string;
  readonly displayName: string;
  readonly roleId: string;
}

export interface WorkOrderAuditEntry {
  readonly actor: WorkOrderActor;
  readonly permission: string;
  readonly entityId: 'work_order' | 'sla_policy';
  readonly recordId: number;
  readonly result: 'success';
  readonly details: Readonly<Record<string, unknown>>;
}

export interface WorkOrderContext {
  readonly connection: DatabaseSync;
  readonly actor: WorkOrderActor;
  readonly requirePermission: (actor: WorkOrderActor, permission: string) => void;
  readonly appendAudit: (connection: DatabaseSync, event: WorkOrderAuditEntry) => void;
  readonly identityHasRole: (
    identityId: string,
    roleId: string,
    connection: DatabaseSync
  ) => boolean;
  readonly now: () => Date;
  readonly orderCode: () => string;
  readonly eventCode: () => string;
}

export interface CreateWorkOrderRequest {
  readonly title: string;
  readonly description: string;
  readonly serviceCode: string;
  readonly priority: WorkOrderPriority;
}

export interface DispatchWorkOrderRequest {
  readonly workOrderId: number;
  readonly expectedVersion: number;
  readonly handlerId: string;
  readonly reason: string;
}

export interface AcceptWorkOrderRequest {
  readonly workOrderId: number;
  readonly expectedVersion: number;
}

export interface AddProcessingRecordRequest {
  readonly workOrderId: number;
  readonly expectedVersion: number;
  readonly content: string;
}

export interface SubmitResolutionRequest {
  readonly workOrderId: number;
  readonly expectedVersion: number;
  readonly resolution: string;
}

export interface RejectWorkOrderReviewRequest {
  readonly workOrderId: number;
  readonly expectedVersion: number;
  readonly reason: string;
}

export interface ApproveWorkOrderCloseRequest {
  readonly workOrderId: number;
  readonly expectedVersion: number;
  readonly comment: string;
}

export interface CreateSlaPolicyRequest {
  readonly code: string;
  readonly name: string;
  readonly serviceCode: string;
  readonly priority: WorkOrderPriority;
  readonly responseMinutes: number;
  readonly resolutionMinutes: number;
  readonly active: boolean;
}

export interface UpdateSlaPolicyRequest {
  readonly policyId: number;
  readonly expectedVersion: number;
  readonly name: string;
  readonly serviceCode: string;
  readonly priority: WorkOrderPriority;
  readonly responseMinutes: number;
  readonly resolutionMinutes: number;
  readonly active: boolean;
}

export interface SlaPolicyResult {
  readonly policyId: number;
  readonly code: string;
  readonly version: number;
  readonly responseMinutes: number;
  readonly resolutionMinutes: number;
  readonly active: boolean;
}

export interface WorkOrderResult {
  readonly workOrderId: number;
  readonly workOrderCode: string;
  readonly status: WorkOrderStatus;
  readonly version: number;
  readonly slaPolicyCode: string;
  readonly responseDueAt: string;
  readonly resolutionDueAt: string;
  readonly handlerId: string | null;
  readonly acceptedAt: string | null;
  readonly resolution: string | null;
  readonly submittedAt: string | null;
  readonly closedAt: string | null;
}

export interface WorkOrderSlaStatus {
  readonly response: 'pending' | 'met' | 'overdue';
  readonly resolution: 'pending' | 'met' | 'overdue';
}

export interface WorkOrderDashboardSummary {
  readonly total: number;
  readonly pendingReview: number;
  readonly closed: number;
  readonly overdue: number;
}
