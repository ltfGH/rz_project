import { AppError } from '../../../../desktop-runtime/src/shared/errors';

import { calculateDeadline } from './sla';
import type {
  AcceptWorkOrderRequest,
  CreateWorkOrderRequest,
  DispatchWorkOrderRequest,
  WorkOrderContext,
  WorkOrderPriority,
  WorkOrderResult,
  WorkOrderStatus
} from './types';

interface ServiceRow {
  readonly code: string;
  readonly active: number;
}

interface SlaRow {
  readonly code: string;
  readonly response_minutes: number;
  readonly resolution_minutes: number;
}

interface WorkOrderRow {
  readonly id: number;
  readonly code: string;
  readonly status: WorkOrderStatus;
  readonly version: number;
  readonly handler_id: string | null;
  readonly accepted_at: string | null;
  readonly sla_policy_code: string;
  readonly response_due_at: string;
  readonly resolution_due_at: string;
}

const CREATE_PERMISSION = 'work_orders.create_order';
const PRIORITIES = new Set<WorkOrderPriority>(['low', 'normal', 'high', 'urgent']);

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError('VALIDATION_FAILED', `${field} is required.`, {
      fieldErrors: [{ field, message: 'Required.' }]
    });
  }
  return normalized;
}

function readWorkOrder(workOrderId: number, context: WorkOrderContext): WorkOrderRow {
  const row = context.connection.prepare(
    `SELECT id, code, status, version, handler_id, accepted_at, sla_policy_code,
            response_due_at, resolution_due_at
     FROM biz_work_order WHERE id = ?`
  ).get(workOrderId) as WorkOrderRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Work order was not found.');
  return row;
}

function assertVersion(row: WorkOrderRow, expectedVersion: number): void {
  if (row.version !== expectedVersion) {
    throw new AppError('VERSION_CONFLICT', 'Work order was changed by another operation.');
  }
}

function resultFrom(
  row: WorkOrderRow,
  changes: Readonly<Partial<{
    status: WorkOrderStatus;
    version: number;
    handlerId: string | null;
    acceptedAt: string | null;
  }>> = {}
): WorkOrderResult {
  return Object.freeze({
    workOrderId: row.id,
    workOrderCode: row.code,
    status: changes.status ?? row.status,
    version: changes.version ?? row.version,
    slaPolicyCode: row.sla_policy_code,
    responseDueAt: row.response_due_at,
    resolutionDueAt: row.resolution_due_at,
    handlerId: changes.handlerId === undefined ? row.handler_id : changes.handlerId,
    acceptedAt: changes.acceptedAt === undefined ? row.accepted_at : changes.acceptedAt
  });
}

function appendEvent(
  context: WorkOrderContext,
  row: WorkOrderRow,
  eventType: 'dispatched' | 'accepted',
  fromStatus: WorkOrderStatus,
  toStatus: WorkOrderStatus,
  content: string,
  occurredAt: string
): string {
  const eventCode = context.eventCode();
  context.connection.prepare(
    `INSERT INTO biz_work_order_event
      (code, work_order_code, event_type, from_status, to_status, actor_id,
       content, occurred_at, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    eventCode,
    row.code,
    eventType,
    fromStatus,
    toStatus,
    context.actor.username,
    content,
    occurredAt,
    occurredAt,
    occurredAt
  );
  return eventCode;
}

export class WorkOrderService {
  create(request: CreateWorkOrderRequest, context: WorkOrderContext): WorkOrderResult {
    context.requirePermission(context.actor, CREATE_PERMISSION);
    const title = required(request.title, 'title');
    const description = required(request.description, 'description');
    const serviceCode = required(request.serviceCode, 'serviceCode');
    if (!PRIORITIES.has(request.priority)) {
      throw new AppError('VALIDATION_FAILED', 'Priority is invalid.', {
        fieldErrors: [{ field: 'priority', message: 'Invalid priority.' }]
      });
    }
    if (!context.identityHasRole(
      context.actor.username,
      'work_order_dispatcher',
      context.connection
    )) {
      throw new AppError('VALIDATION_FAILED', 'Requester identity is not an active dispatcher.');
    }

    const catalog = context.connection.prepare(
      'SELECT code, active FROM biz_service_catalog WHERE code = ?'
    ).get(serviceCode) as ServiceRow | undefined;
    if (!catalog || catalog.active !== 1) {
      throw new AppError('VALIDATION_FAILED', 'Service catalog does not exist or is inactive.');
    }
    const policies = context.connection.prepare(
      `SELECT code, response_minutes, resolution_minutes
       FROM biz_sla_policy
       WHERE service_code = ? AND priority = ? AND active = 1
       ORDER BY id`
    ).all(serviceCode, request.priority) as unknown as SlaRow[];
    if (policies.length !== 1) {
      throw new AppError(
        'VALIDATION_FAILED',
        policies.length === 0
          ? 'No active SLA policy matches the service and priority.'
          : 'Multiple active SLA policies match the service and priority.'
      );
    }
    const policy = policies[0]!;
    const occurredAt = context.now();
    const occurredAtIso = occurredAt.toISOString();
    const responseDueAt = calculateDeadline(occurredAt, Number(policy.response_minutes));
    const resolutionDueAt = calculateDeadline(occurredAt, Number(policy.resolution_minutes));
    const workOrderCode = context.orderCode();

    let workOrderId: number;
    try {
      const inserted = context.connection.prepare(
        `INSERT INTO biz_work_order
          (code, title, description, service_code, sla_policy_code, priority, status,
           requester_id, handler_id, resolution, response_due_at, resolution_due_at,
           accepted_at, submitted_at, closed_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_dispatch', ?, NULL, NULL, ?, ?, NULL, NULL, NULL, 1, ?, ?)`
      ).run(
        workOrderCode,
        title,
        description,
        serviceCode,
        policy.code,
        request.priority,
        context.actor.username,
        responseDueAt,
        resolutionDueAt,
        occurredAtIso,
        occurredAtIso
      );
      workOrderId = Number(inserted.lastInsertRowid);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new AppError('UNIQUE_CONFLICT', 'Work order code already exists.');
      }
      throw error;
    }

    const eventCode = context.eventCode();
    context.connection.prepare(
      `INSERT INTO biz_work_order_event
        (code, work_order_code, event_type, from_status, to_status, actor_id,
         content, occurred_at, version, created_at, updated_at)
       VALUES (?, ?, 'created', NULL, 'pending_dispatch', ?, ?, ?, 1, ?, ?)`
    ).run(
      eventCode,
      workOrderCode,
      context.actor.username,
      title,
      occurredAtIso,
      occurredAtIso,
      occurredAtIso
    );

    context.appendAudit(context.connection, Object.freeze({
      actor: context.actor,
      permission: CREATE_PERMISSION,
      entityId: 'work_order',
      recordId: workOrderId,
      result: 'success',
      details: Object.freeze({
        eventCode,
        workOrderCode,
        serviceCode,
        priority: request.priority,
        slaPolicyCode: policy.code
      })
    }));

    return Object.freeze({
      workOrderId,
      workOrderCode,
      status: 'pending_dispatch',
      version: 1,
      slaPolicyCode: policy.code,
      responseDueAt,
      resolutionDueAt,
      handlerId: null,
      acceptedAt: null
    });
  }

  dispatch(request: DispatchWorkOrderRequest, context: WorkOrderContext): WorkOrderResult {
    const permission = 'work_orders.dispatch';
    context.requirePermission(context.actor, permission);
    const handlerId = required(request.handlerId, 'handlerId');
    const reason = required(request.reason, 'reason');
    if (!context.identityHasRole(handlerId, 'work_order_handler', context.connection)) {
      throw new AppError('VALIDATION_FAILED', 'Handler identity is not an active work order handler.');
    }
    const row = readWorkOrder(request.workOrderId, context);
    assertVersion(row, request.expectedVersion);
    if (row.status !== 'pending_dispatch' && row.status !== 'pending_acceptance') {
      throw new AppError('INVALID_TRANSITION', 'Work order cannot be dispatched from its current state.');
    }
    const occurredAt = context.now().toISOString();
    const update = context.connection.prepare(
      `UPDATE biz_work_order
       SET handler_id = ?, status = 'pending_acceptance', version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`
    ).run(handlerId, occurredAt, row.id, request.expectedVersion);
    if (Number(update.changes) !== 1) {
      throw new AppError('VERSION_CONFLICT', 'Work order was changed by another operation.');
    }
    const eventCode = appendEvent(
      context,
      row,
      'dispatched',
      row.status,
      'pending_acceptance',
      reason,
      occurredAt
    );
    context.appendAudit(context.connection, Object.freeze({
      actor: context.actor,
      permission,
      entityId: 'work_order',
      recordId: row.id,
      result: 'success',
      details: Object.freeze({ eventCode, handlerId, reason, fromStatus: row.status })
    }));
    return resultFrom(row, {
      status: 'pending_acceptance', version: row.version + 1, handlerId
    });
  }

  accept(request: AcceptWorkOrderRequest, context: WorkOrderContext): WorkOrderResult {
    const permission = 'work_orders.accept';
    context.requirePermission(context.actor, permission);
    const row = readWorkOrder(request.workOrderId, context);
    assertVersion(row, request.expectedVersion);
    if (row.status !== 'pending_acceptance') {
      throw new AppError('INVALID_TRANSITION', 'Work order cannot be accepted from its current state.');
    }
    if (row.handler_id !== context.actor.username) {
      throw new AppError('PERMISSION_DENIED', 'Only the assigned handler can accept this work order.');
    }
    if (!context.identityHasRole(context.actor.username, 'work_order_handler', context.connection)) {
      throw new AppError('PERMISSION_DENIED', 'Current identity is not an active work order handler.');
    }
    const occurredAt = context.now().toISOString();
    const update = context.connection.prepare(
      `UPDATE biz_work_order
       SET status = 'processing', accepted_at = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`
    ).run(occurredAt, occurredAt, row.id, request.expectedVersion);
    if (Number(update.changes) !== 1) {
      throw new AppError('VERSION_CONFLICT', 'Work order was changed by another operation.');
    }
    const eventCode = appendEvent(
      context,
      row,
      'accepted',
      'pending_acceptance',
      'processing',
      'Work order accepted.',
      occurredAt
    );
    context.appendAudit(context.connection, Object.freeze({
      actor: context.actor,
      permission,
      entityId: 'work_order',
      recordId: row.id,
      result: 'success',
      details: Object.freeze({ eventCode, handlerId: row.handler_id, acceptedAt: occurredAt })
    }));
    return resultFrom(row, {
      status: 'processing', version: row.version + 1, acceptedAt: occurredAt
    });
  }
}
