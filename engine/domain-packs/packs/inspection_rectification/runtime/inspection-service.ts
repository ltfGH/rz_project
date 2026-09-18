import { AppError } from '../../../../desktop-runtime/src/shared/errors';

import type {
  AssignInspectionExecutorRequest,
  CreateInspectionPlanRequest,
  CreateInspectionTaskRequest,
  InspectionContext,
  InspectionPlanResult,
  InspectionItemUpdateResult,
  InspectionTaskResult,
  RecordInspectionItemRequest,
  StartInspectionTaskRequest,
  UpdateInspectionPlanRequest
} from './types';

interface TaskRow {
  readonly id: number;
  readonly code: string;
  readonly status: 'pending' | 'executing' | 'pending_review' | 'archived';
  readonly version: number;
  readonly executor_id: string;
  readonly started_at: string | null;
  readonly submitted_at: string | null;
  readonly archived_at: string | null;
}

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

function readTask(taskId: number, context: InspectionContext): TaskRow {
  const row = context.connection.prepare(
    `SELECT id, code, status, version, executor_id, started_at, submitted_at, archived_at
     FROM biz_inspection_task WHERE id = ?`
  ).get(taskId) as TaskRow | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Inspection task was not found.');
  return row;
}

function assertExecutor(row: TaskRow, context: InspectionContext): void {
  if (row.executor_id !== context.actor.username || !context.identityHasRole(
    context.actor.username, 'inspection_executor', context.connection
  )) throw new AppError('PERMISSION_DENIED', 'Only the assigned executor can change this task.');
}

function taskResult(row: TaskRow, context: InspectionContext, changes: Partial<{
  status: TaskRow['status']; version: number; executorId: string; startedAt: string | null;
}> = {}): InspectionTaskResult {
  const itemRows = context.connection.prepare(
    'SELECT id FROM biz_inspection_item WHERE task_code = ? ORDER BY id'
  ).all(row.code) as unknown as Array<{ id: number }>;
  return Object.freeze({
    taskId: row.id, taskCode: row.code, status: changes.status ?? row.status,
    version: changes.version ?? row.version,
    executorId: changes.executorId ?? row.executor_id,
    startedAt: changes.startedAt === undefined ? row.started_at : changes.startedAt,
    submittedAt: row.submitted_at, archivedAt: row.archived_at,
    itemIds: Object.freeze(itemRows.map((item) => Number(item.id)))
  });
}

function appendTaskEvent(
  context: InspectionContext, row: TaskRow,
  type: 'assigned' | 'started' | 'item_recorded',
  from: TaskRow['status'], to: TaskRow['status'], content: string, occurredAt: string
): string {
  const code = context.eventCode();
  context.connection.prepare(
    `INSERT INTO biz_inspection_event
      (code, task_code, event_type, from_status, to_status, actor_id,
       content, occurred_at, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(code, row.code, type, from, to, context.actor.username, content, occurredAt, occurredAt, occurredAt);
  return code;
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

  assignExecutor(request: AssignInspectionExecutorRequest, context: InspectionContext): InspectionTaskResult {
    const permission = 'inspection_tasks.assign';
    context.requirePermission(context.actor, permission);
    const executorId = required(request.executorId, 'executorId');
    const reason = required(request.reason, 'reason');
    if (!context.identityHasRole(executorId, 'inspection_executor', context.connection)) {
      throw new AppError('VALIDATION_FAILED', 'Executor identity is not active.');
    }
    const row = readTask(request.taskId, context);
    if (row.status !== 'pending') throw new AppError('INVALID_TRANSITION', 'Only pending tasks can be assigned.');
    if (row.version !== request.expectedTaskVersion) throw new AppError('VERSION_CONFLICT', 'Task version conflict.');
    const now = context.now().toISOString();
    const update = context.connection.prepare(
      `UPDATE biz_inspection_task SET executor_id = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`
    ).run(executorId, now, row.id, request.expectedTaskVersion);
    if (Number(update.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Task version conflict.');
    const eventCode = appendTaskEvent(context, row, 'assigned', 'pending', 'pending', reason, now);
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission,
      entityId: 'inspection_task', recordId: row.id, result: 'success',
      details: Object.freeze({ eventCode, executorId, reason }) }));
    return taskResult(row, context, { version: row.version + 1, executorId });
  }

  startTask(request: StartInspectionTaskRequest, context: InspectionContext): InspectionTaskResult {
    const permission = 'inspection_tasks.execute';
    context.requirePermission(context.actor, permission);
    const row = readTask(request.taskId, context);
    assertExecutor(row, context);
    if (row.status !== 'pending') throw new AppError('INVALID_TRANSITION', 'Only pending tasks can start.');
    if (row.version !== request.expectedTaskVersion) throw new AppError('VERSION_CONFLICT', 'Task version conflict.');
    const now = context.now().toISOString();
    const update = context.connection.prepare(
      `UPDATE biz_inspection_task SET status = 'executing', started_at = ?,
       version = version + 1, updated_at = ? WHERE id = ? AND version = ?`
    ).run(now, now, row.id, request.expectedTaskVersion);
    if (Number(update.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Task version conflict.');
    const eventCode = appendTaskEvent(context, row, 'started', 'pending', 'executing', '开始巡检', now);
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission,
      entityId: 'inspection_task', recordId: row.id, result: 'success', details: Object.freeze({ eventCode }) }));
    return taskResult(row, context, { status: 'executing', version: row.version + 1, startedAt: now });
  }

  recordItemResult(request: RecordInspectionItemRequest, context: InspectionContext): InspectionItemUpdateResult {
    const permission = 'inspection_items.record_result';
    context.requirePermission(context.actor, permission);
    const row = readTask(request.taskId, context);
    assertExecutor(row, context);
    if (row.status !== 'executing') throw new AppError('INVALID_TRANSITION', 'Task is not executing.');
    if (row.version !== request.expectedTaskVersion) throw new AppError('VERSION_CONFLICT', 'Task version conflict.');
    const item = context.connection.prepare(
      'SELECT id, task_code, version FROM biz_inspection_item WHERE id = ?'
    ).get(request.itemId) as { id: number; task_code: string; version: number } | undefined;
    if (!item || item.task_code !== row.code) throw new AppError('NOT_FOUND', 'Inspection item was not found for this task.');
    if (item.version !== request.expectedItemVersion) throw new AppError('VERSION_CONFLICT', 'Item version conflict.');
    let finding: string | null = null;
    let disposition: string | null = null;
    if (request.result === 'abnormal') {
      finding = required(request.finding ?? '', 'finding');
      disposition = required(request.disposition ?? '', 'disposition');
    }
    const now = context.now().toISOString();
    const itemUpdate = context.connection.prepare(
      `UPDATE biz_inspection_item SET result = ?, finding = ?, disposition = ?, checked_at = ?,
       version = version + 1, updated_at = ? WHERE id = ? AND version = ?`
    ).run(request.result, finding, disposition, now, now, item.id, request.expectedItemVersion);
    if (Number(itemUpdate.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Item version conflict.');
    const taskUpdate = context.connection.prepare(
      `UPDATE biz_inspection_task SET version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`
    ).run(now, row.id, request.expectedTaskVersion);
    if (Number(taskUpdate.changes) !== 1) throw new AppError('VERSION_CONFLICT', 'Task version conflict.');
    const eventCode = appendTaskEvent(context, row, 'item_recorded', 'executing', 'executing', request.result, now);
    context.appendAudit(context.connection, Object.freeze({ actor: context.actor, permission,
      entityId: 'inspection_item', recordId: item.id, result: 'success',
      details: Object.freeze({ eventCode, result: request.result }) }));
    return Object.freeze({ taskId: row.id, itemId: item.id, taskVersion: row.version + 1,
      itemVersion: item.version + 1, result: request.result });
  }
}
