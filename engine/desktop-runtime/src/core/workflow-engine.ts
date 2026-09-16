import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

import type {
  JsonValue,
  RuntimeAction,
  RuntimeBlueprint,
  RuntimeCondition,
  RuntimeEntity,
  RuntimeRelation,
  RuntimeTransition,
  RuntimeWorkflow
} from '../shared/blueprint';
import type { ActorDto, AllowedTransitionDto, EntityRecordDto } from '../shared/dto';
import { AppError } from '../shared/errors';
import type { AuditService } from './audit-service';
import type { RuntimeDatabase } from './database';
import { EntityRepository } from './entity-repository';
import type { PermissionService } from './permission-service';
import type { CompiledSchema } from './schema-compiler';

export interface ExecuteTransitionRequest {
  readonly workflowId: string;
  readonly transitionId: string;
  readonly recordId: number;
  readonly expectedVersion: number;
  readonly actor: ActorDto;
  readonly input: Readonly<Record<string, JsonValue>>;
}

const IDENTIFIER = /^[a-z][a-z0-9_]{1,63}$/;

interface QueryConnection {
  prepare(sql: string): StatementSync;
}

function quote(value: string): string {
  if (!IDENTIFIER.test(value)) throw new AppError('BLUEPRINT_INCOMPATIBLE', `Unsafe identifier '${value}'.`);
  return `"${value}"`;
}

function parameterName(condition: RuntimeCondition, key: string): string {
  const value = condition.parameters[key];
  if (typeof value !== 'string') {
    throw new AppError('INVALID_TRANSITION', `Condition '${condition.type}' has invalid '${key}'.`);
  }
  return value;
}

export function evaluateCondition(
  condition: RuntimeCondition,
  record: Readonly<Record<string, unknown>>,
  relationExists: (relationId: string) => boolean
): boolean {
  switch (condition.type) {
    case 'required_field': {
      const value = record[parameterName(condition, 'field')];
      return value !== null && value !== undefined && value !== '';
    }
    case 'field_equals':
      return record[parameterName(condition, 'field')] === condition.parameters.value;
    case 'relation_exists':
      return relationExists(parameterName(condition, 'relation'));
    default:
      throw new AppError('INVALID_TRANSITION', 'Workflow contains an unknown condition type.');
  }
}

export class WorkflowEngine {
  readonly #database: RuntimeDatabase;
  readonly #blueprint: RuntimeBlueprint;
  readonly #schema: CompiledSchema;
  readonly #permissions: PermissionService;
  readonly #audit: AuditService;
  readonly #repository: EntityRepository;
  readonly #entities: ReadonlyMap<string, RuntimeEntity>;
  readonly #workflows: ReadonlyMap<string, RuntimeWorkflow>;

  constructor(
    database: RuntimeDatabase,
    blueprint: RuntimeBlueprint,
    schema: CompiledSchema,
    permissions: PermissionService,
    audit: AuditService
  ) {
    this.#database = database;
    this.#blueprint = blueprint;
    this.#schema = schema;
    this.#permissions = permissions;
    this.#audit = audit;
    this.#repository = new EntityRepository(database, blueprint, schema);
    this.#entities = new Map((blueprint.entities ?? []).map((entity) => [entity.id, entity]));
    this.#workflows = new Map((blueprint.workflows ?? []).map((workflow) => [workflow.id, workflow]));
  }

  allowedActions(entityId: string, recordId: number, actor: ActorDto): readonly AllowedTransitionDto[] {
    const workflow = [...this.#workflows.values()].find((item) => item.entity === entityId);
    if (!workflow) return [];
    const entity = this.#requireEntity(entityId);
    const table = this.#requireTable(entityId);
    const record = this.#database.prepare(`SELECT * FROM ${quote(table)} WHERE "id" = ?`).get(recordId) as
      Record<string, unknown> | undefined;
    if (!record) throw new AppError('NOT_FOUND', '记录不存在。');
    const state = String(record.status);
    return Object.freeze(workflow.transitions
      .filter((transition) => transition.from === state)
      .filter((transition) => this.#permissions.allows(actor, transition.permission))
      .filter((transition) => transition.conditions.every((condition) => evaluateCondition(
        condition,
        record,
        (relationId) => this.#relationExists(this.#database, entity, record, relationId)
      )))
      .map((transition) => Object.freeze({
        workflowId: workflow.id,
        transitionId: transition.id,
        name: transition.name,
        allowed: true
      })));
  }

  execute(request: ExecuteTransitionRequest): EntityRecordDto {
    const workflow = this.#workflows.get(request.workflowId);
    if (!workflow) throw new AppError('INVALID_TRANSITION', '流程不存在。');
    const transition = workflow.transitions.find((item) => item.id === request.transitionId);
    if (!transition) throw new AppError('INVALID_TRANSITION', '流程操作不存在。');
    const entity = this.#requireEntity(workflow.entity);
    const table = this.#requireTable(entity.id);

    try {
      this.#database.transaction((connection) => {
        const record = connection.prepare(
          `SELECT * FROM ${quote(table)} WHERE "id" = ?`
        ).get(request.recordId) as Record<string, unknown> | undefined;
        if (!record) throw new AppError('NOT_FOUND', '记录不存在。');
        if (Number(record.version) !== request.expectedVersion) {
          throw new AppError('VERSION_CONFLICT', '记录已被其他操作更新。');
        }
        if (record.status !== transition.from) {
          throw new AppError('INVALID_TRANSITION', '当前状态不允许执行此操作。');
        }
        this.#permissions.require(request.actor, transition.permission);
        const effectiveRecord = { ...record, ...request.input };
        for (const condition of transition.conditions) {
          if (!evaluateCondition(
            condition,
            effectiveRecord,
            (relationId) => this.#relationExists(connection, entity, effectiveRecord, relationId)
          )) {
            throw new AppError('INVALID_TRANSITION', '流程条件未满足。');
          }
        }

        const mainUpdates = new Map<string, JsonValue>();
        for (const [field, value] of Object.entries(request.input)) mainUpdates.set(field, value);
        for (const action of transition.actions) {
          if (action.type === 'set_field') {
            const field = action.parameters.field;
            if (typeof field !== 'string') throw new AppError('INVALID_TRANSITION', 'set_field 缺少字段。');
            mainUpdates.set(field, action.parameters.value ?? null);
          }
        }
        mainUpdates.set('status', transition.to);
        this.#updateMain(connection, entity, table, request, mainUpdates);

        for (const action of transition.actions) {
          this.#executeAction(connection, entity, effectiveRecord, action);
        }
        connection.prepare([
          'INSERT INTO sys_workflow_event',
          '(workflow_id, entity_id, record_id, transition_id, from_state, to_state, actor_id, created_at)',
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ].join(' ')).run(
          workflow.id,
          entity.id,
          request.recordId,
          transition.id,
          transition.from,
          transition.to,
          request.actor.userId,
          new Date().toISOString()
        );
        this.#audit.append(connection, {
          actor: request.actor,
          permission: transition.permission,
          entityId: entity.id,
          recordId: request.recordId,
          result: 'success',
          details: { workflow: workflow.id, transition: transition.id }
        });
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed/i.test(message)) {
        throw new AppError('UNIQUE_CONFLICT', '流程动作创建了重复记录。');
      }
      if (/constraint failed/i.test(message)) {
        throw new AppError('VALIDATION_FAILED', '流程动作未通过数据约束。');
      }
      throw new AppError('INTERNAL_ERROR', '流程执行失败。', { cause: error });
    }
    return this.#repository.get(entity.id, request.recordId, request.actor);
  }

  #updateMain(
    connection: QueryConnection,
    entity: RuntimeEntity,
    table: string,
    request: ExecuteTransitionRequest,
    updates: ReadonlyMap<string, JsonValue>
  ): void {
    const fields = new Set(entity.fields.map((field) => field.id));
    const assignments: string[] = [];
    const values: SQLInputValue[] = [];
    for (const [field, value] of updates) {
      if (!fields.has(field)) throw new AppError('INVALID_TRANSITION', `流程写入未知字段 '${field}'。`);
      assignments.push(`${quote(field)} = ?`);
      values.push(this.#sqlValue(value));
    }
    assignments.push('"version" = "version" + 1', '"updated_at" = ?');
    values.push(new Date().toISOString(), request.recordId, request.expectedVersion);
    const result = connection.prepare(
      `UPDATE ${quote(table)} SET ${assignments.join(', ')} WHERE "id" = ? AND "version" = ?`
    ).run(...values);
    if (Number(result.changes) === 0) throw new AppError('VERSION_CONFLICT', '记录版本已变化。');
  }

  #executeAction(
    connection: DatabaseSync,
    sourceEntity: RuntimeEntity,
    sourceRecord: Readonly<Record<string, unknown>>,
    action: RuntimeAction
  ): void {
    switch (action.type) {
      case 'set_field':
      case 'append_event':
      case 'write_audit':
        return;
      case 'create_record': {
        const entityId = action.parameters.entity;
        const values = action.parameters.values;
        if (typeof entityId !== 'string' || !values || typeof values !== 'object' || Array.isArray(values)) {
          throw new AppError('INVALID_TRANSITION', 'create_record 参数无效。');
        }
        const entity = this.#requireEntity(entityId);
        this.#insertRecord(connection, entity, values as Record<string, JsonValue>);
        return;
      }
      case 'update_related': {
        const relationId = action.parameters.relation;
        const values = action.parameters.values;
        if (typeof relationId !== 'string' || !values || typeof values !== 'object' || Array.isArray(values)) {
          throw new AppError('INVALID_TRANSITION', 'update_related 参数无效。');
        }
        const relation = sourceEntity.relations.find((item) => item.id === relationId);
        if (!relation) throw new AppError('INVALID_TRANSITION', `关联 '${relationId}' 不存在。`);
        this.#updateRelated(connection, relation, sourceRecord, values as Record<string, JsonValue>);
        return;
      }
      default:
        throw new AppError('INVALID_TRANSITION', '流程包含未知动作类型。');
    }
  }

  #insertRecord(connection: DatabaseSync, entity: RuntimeEntity, values: Record<string, JsonValue>): void {
    const fields = new Set(entity.fields.map((field) => field.id));
    for (const key of Object.keys(values)) {
      if (!fields.has(key)) throw new AppError('INVALID_TRANSITION', `动作写入未知字段 '${entity.id}.${key}'。`);
    }
    const now = new Date().toISOString();
    const columns = [...Object.keys(values), 'created_at', 'updated_at'];
    connection.prepare(
      `INSERT INTO ${quote(this.#requireTable(entity.id))} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).run(...Object.values(values).map((value) => this.#sqlValue(value)), now, now);
  }

  #updateRelated(
    connection: DatabaseSync,
    relation: RuntimeRelation,
    sourceRecord: Readonly<Record<string, unknown>>,
    values: Record<string, JsonValue>
  ): void {
    const target = this.#requireEntity(relation.targetEntity);
    const fields = new Set(target.fields.map((field) => field.id));
    for (const key of Object.keys(values)) {
      if (!fields.has(key)) throw new AppError('INVALID_TRANSITION', `动作写入未知字段 '${target.id}.${key}'。`);
    }
    const keys = Object.keys(values);
    const assignments = keys.map((key) => `${quote(key)} = ?`);
    assignments.push('"version" = "version" + 1', '"updated_at" = ?');
    const result = connection.prepare(
      `UPDATE ${quote(this.#requireTable(target.id))} SET ${assignments.join(', ')} WHERE ${quote(relation.targetField)} = ?`
    ).run(
      ...keys.map((key) => this.#sqlValue(values[key]!)),
      new Date().toISOString(),
      this.#sqlValue(sourceRecord[relation.field] as JsonValue)
    );
    if (Number(result.changes) === 0) throw new AppError('INVALID_TRANSITION', '关联记录不存在。');
  }

  #relationExists(
    connection: QueryConnection,
    entity: RuntimeEntity,
    record: Readonly<Record<string, unknown>>,
    relationId: string
  ): boolean {
    const relation = entity.relations.find((item) => item.id === relationId);
    if (!relation) throw new AppError('INVALID_TRANSITION', `关联 '${relationId}' 不存在。`);
    const value = record[relation.field];
    if (value === null || value === undefined) return false;
    const found = connection.prepare(
      `SELECT 1 AS found FROM ${quote(this.#requireTable(relation.targetEntity))} WHERE ${quote(relation.targetField)} = ?`
    ).get(this.#sqlValue(value as JsonValue));
    return Boolean(found);
  }

  #requireEntity(entityId: string): RuntimeEntity {
    const entity = this.#entities.get(entityId);
    if (!entity) throw new AppError('BLUEPRINT_INCOMPATIBLE', `Entity '${entityId}' is missing.`);
    return entity;
  }

  #requireTable(entityId: string): string {
    const table = this.#schema.entityTables[entityId];
    if (!table) throw new AppError('BLUEPRINT_INCOMPATIBLE', `Entity '${entityId}' has no table.`);
    return table;
  }

  #sqlValue(value: JsonValue): SQLInputValue {
    if (value === null || typeof value === 'string' || typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    throw new AppError('INVALID_TRANSITION', '流程动作值必须是标量。');
  }
}
