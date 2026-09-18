import { AppError } from '../../../../desktop-runtime/src/shared/errors';

import type {
  CreateInspectionPlanRequest,
  CreateInspectionTaskRequest,
  InspectionContext,
  InspectionPlanResult,
  InspectionTaskResult,
  UpdateInspectionPlanRequest
} from './types';

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError('VALIDATION_FAILED', `${field} is required.`, {
      fieldErrors: [{ field, message: 'Required.' }]
    });
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('VALIDATION_FAILED', `${field} must be a positive integer.`, {
      fieldErrors: [{ field, message: 'Must be a positive integer.' }]
    });
  }
  return value;
}

function dateTime(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new AppError('VALIDATION_FAILED', `${field} must be a valid date.`, {
      fieldErrors: [{ field, message: 'Invalid date.' }]
    });
  }
  return new Date(timestamp).toISOString();
}

function assertPlanManager(context: InspectionContext): void {
  const valid = context.identityHasRole(
    context.actor.username, 'inspection_planner', context.connection
  ) || context.identityHasRole(
    context.actor.username, 'inspection_admin', context.connection
  );
  if (!valid) throw new AppError('PERMISSION_DENIED', 'Current identity cannot manage inspection plans.');
}

export class InspectionService {
  createPlan(
    request: CreateInspectionPlanRequest,
    context: InspectionContext
  ): InspectionPlanResult {
    const permission = 'inspection_plans.create_plan';
    context.requirePermission(context.actor, permission);
    assertPlanManager(context);
    const name = required(request.name, 'name');
    const instructions = required(request.instructions, 'instructions');
    const cycleDays = positiveInteger(request.cycleDays, 'cycleDays');
    const code = context.planCode();
    const now = context.now().toISOString();
    let planId: number;
    try {
      const inserted = context.connection.prepare(
        `INSERT INTO biz_inspection_plan
          (code, name, cycle_days, instructions, active, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(code, name, cycleDays, instructions, request.active ? 1 : 0, now, now);
      planId = Number(inserted.lastInsertRowid);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new AppError('UNIQUE_CONFLICT', 'Inspection plan code already exists.');
      }
      throw error;
    }
    context.appendAudit(context.connection, Object.freeze({
      actor: context.actor,
      permission,
      entityId: 'inspection_plan',
      recordId: planId,
      result: 'success',
      details: Object.freeze({ code, cycleDays, active: request.active })
    }));
    return Object.freeze({ planId, planCode: code, version: 1, cycleDays, active: request.active });
  }

  updatePlan(
    request: UpdateInspectionPlanRequest,
    context: InspectionContext
  ): InspectionPlanResult {
    const permission = 'inspection_plans.update_plan';
    context.requirePermission(context.actor, permission);
    assertPlanManager(context);
    const row = context.connection.prepare(
      'SELECT id, code, version FROM biz_inspection_plan WHERE id = ?'
    ).get(request.planId) as { id: number; code: string; version: number } | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Inspection plan was not found.');
    if (row.version !== request.expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'Inspection plan was changed by another operation.');
    }
    const name = required(request.name, 'name');
    const instructions = required(request.instructions, 'instructions');
    const cycleDays = positiveInteger(request.cycleDays, 'cycleDays');
    const now = context.now().toISOString();
    const update = context.connection.prepare(
      `UPDATE biz_inspection_plan
       SET name = ?, cycle_days = ?, instructions = ?, active = ?,
           version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`
    ).run(
      name, cycleDays, instructions, request.active ? 1 : 0,
      now, row.id, request.expectedVersion
    );
    if (Number(update.changes) !== 1) {
      throw new AppError('VERSION_CONFLICT', 'Inspection plan was changed by another operation.');
    }
    context.appendAudit(context.connection, Object.freeze({
      actor: context.actor,
      permission,
      entityId: 'inspection_plan',
      recordId: row.id,
      result: 'success',
      details: Object.freeze({ code: row.code, cycleDays, active: request.active })
    }));
    return Object.freeze({
      planId: row.id,
      planCode: row.code,
      version: row.version + 1,
      cycleDays,
      active: request.active
    });
  }

  createTask(
    request: CreateInspectionTaskRequest,
    context: InspectionContext
  ): InspectionTaskResult {
    const permission = 'inspection_tasks.create_task';
    context.requirePermission(context.actor, permission);
    if (!context.identityHasRole(context.actor.username, 'inspection_planner', context.connection)) {
      throw new AppError('PERMISSION_DENIED', 'Current identity is not an active inspection planner.');
    }
    const planCode = required(request.planCode, 'planCode');
    const title = required(request.title, 'title');
    const executorId = required(request.executorId, 'executorId');
    const scheduledAt = dateTime(request.scheduledAt, 'scheduledAt');
    if (!context.identityHasRole(executorId, 'inspection_executor', context.connection)) {
      throw new AppError('VALIDATION_FAILED', 'Executor identity is not an active inspection executor.');
    }
    if (!Array.isArray(request.items) || request.items.length < 1 || request.items.length > 100) {
      throw new AppError('VALIDATION_FAILED', 'Inspection task requires 1 to 100 items.');
    }
    const items = request.items.map((item, index) => ({
      name: required(item.name, `items.${index}.name`),
      standard: required(item.standard, `items.${index}.standard`)
    }));
    if (new Set(items.map((item) => item.name)).size !== items.length) {
      throw new AppError('VALIDATION_FAILED', 'Inspection item names must be unique within a task.');
    }
    const plan = context.connection.prepare(
      'SELECT code, active FROM biz_inspection_plan WHERE code = ?'
    ).get(planCode) as { code: string; active: number } | undefined;
    if (!plan || plan.active !== 1) {
      throw new AppError('VALIDATION_FAILED', 'Inspection plan does not exist or is inactive.');
    }
    const taskCode = context.taskCode();
    const now = context.now().toISOString();
    let taskId: number;
    try {
      const inserted = context.connection.prepare(
        `INSERT INTO biz_inspection_task
          (code, plan_code, title, status, executor_id, scheduled_at,
           started_at, submitted_at, archived_at, version, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, 1, ?, ?)`
      ).run(taskCode, planCode, title, executorId, scheduledAt, now, now);
      taskId = Number(inserted.lastInsertRowid);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new AppError('UNIQUE_CONFLICT', 'Inspection task code already exists.');
      }
      throw error;
    }
    const itemIds: number[] = [];
    for (const item of items) {
      const inserted = context.connection.prepare(
        `INSERT INTO biz_inspection_item
          (code, task_code, name, standard, result, finding, disposition,
           checked_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', NULL, NULL, NULL, 1, ?, ?)`
      ).run(context.itemCode(), taskCode, item.name, item.standard, now, now);
      itemIds.push(Number(inserted.lastInsertRowid));
    }
    const eventCode = context.eventCode();
    context.connection.prepare(
      `INSERT INTO biz_inspection_event
        (code, task_code, event_type, from_status, to_status, actor_id,
         content, occurred_at, version, created_at, updated_at)
       VALUES (?, ?, 'created', NULL, 'pending', ?, ?, ?, 1, ?, ?)`
    ).run(eventCode, taskCode, context.actor.username, title, now, now, now);
    context.appendAudit(context.connection, Object.freeze({
      actor: context.actor,
      permission,
      entityId: 'inspection_task',
      recordId: taskId,
      result: 'success',
      details: Object.freeze({ eventCode, taskCode, planCode, executorId, itemCount: itemIds.length })
    }));
    return Object.freeze({
      taskId,
      taskCode,
      status: 'pending',
      version: 1,
      executorId,
      startedAt: null,
      submittedAt: null,
      archivedAt: null,
      itemIds: Object.freeze(itemIds)
    });
  }
}
