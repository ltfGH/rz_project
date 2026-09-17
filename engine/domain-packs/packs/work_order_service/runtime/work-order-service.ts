import { AppError } from '../../../../desktop-runtime/src/shared/errors';

import { calculateDeadline } from './sla';
import type {
  CreateWorkOrderRequest,
  WorkOrderContext,
  WorkOrderPriority,
  WorkOrderResult
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
      resolutionDueAt
    });
  }
}
