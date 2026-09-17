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
  readonly entityId: 'work_order';
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
}
