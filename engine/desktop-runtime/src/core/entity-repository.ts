import type { SQLInputValue } from 'node:sqlite';

import type {
  JsonValue,
  RuntimeBlueprint,
  RuntimeEntity,
  RuntimeField
} from '../shared/blueprint';
import type { ActorDto, EntityRecordDto, PageDto } from '../shared/dto';
import { AppError, type FieldError } from '../shared/errors';
import type { RuntimeDatabase } from './database';
import type { CompiledSchema } from './schema-compiler';

export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

export interface ListFilter {
  readonly field: string;
  readonly operator: FilterOperator;
  readonly value: JsonValue;
}

export interface ListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly keyword?: string;
  readonly sort?: Readonly<{ field: string; direction: 'asc' | 'desc' }>;
  readonly filters?: readonly ListFilter[];
}

interface EntityMetadata {
  readonly entity: RuntimeEntity;
  readonly table: string;
  readonly fields: ReadonlyMap<string, RuntimeField>;
  readonly modules: readonly Readonly<{
    id: string;
    actions: ReadonlySet<string>;
  }>[];
}

const IDENTIFIER = /^[a-z][a-z0-9_]{1,63}$/;

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', `Unsafe metadata identifier '${value}'.`);
  }
  return `"${value}"`;
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function toSqlValue(field: RuntimeField, value: JsonValue): SQLInputValue {
  if (value === null) return null;
  if (field.type === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number') return value;
  throw new AppError('VALIDATION_FAILED', `字段“${field.name}”的值类型不正确。`, {
    fieldErrors: [{ field: field.id, message: '值类型不正确' }]
  });
}

function fromSqlValue(field: RuntimeField, value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (field.type === 'boolean') return value === 1;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' || typeof value === 'number') return value;
  return String(value);
}

function validateValue(field: RuntimeField, value: unknown): FieldError | undefined {
  if (value === null) {
    return field.required ? { field: field.id, message: '不能为空' } : undefined;
  }
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? undefined : { field: field.id, message: '必须是布尔值' };
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? undefined : { field: field.id, message: '必须是整数' };
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined : { field: field.id, message: '必须是数值' };
    case 'enum':
      return typeof value === 'string' && Boolean(field.options?.includes(value))
        ? undefined : { field: field.id, message: '不在允许选项中' };
    case 'text':
    case 'date':
    case 'datetime':
    case 'reference':
      return typeof value === 'string'
        ? undefined : { field: field.id, message: '必须是文本' };
  }
}

function mapWriteError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) {
    throw new AppError('UNIQUE_CONFLICT', '记录包含重复的唯一值。');
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    throw new AppError('VALIDATION_FAILED', '关联记录不存在或不能使用。');
  }
  if (/NOT NULL constraint failed|CHECK constraint failed/i.test(message)) {
    throw new AppError('VALIDATION_FAILED', '记录未通过数据库约束。');
  }
  throw error;
}

export class EntityRepository {
  readonly #database: RuntimeDatabase;
  readonly #entities: ReadonlyMap<string, EntityMetadata>;
  readonly #rolePermissions: ReadonlyMap<string, ReadonlySet<string>>;

  constructor(database: RuntimeDatabase, blueprint: RuntimeBlueprint, schema: CompiledSchema) {
    this.#database = database;
    const entities = new Map<string, EntityMetadata>();
    const modulesByEntity = new Map<string, Array<{ id: string; actions: ReadonlySet<string> }>>();
    for (const module of blueprint.modules ?? []) {
      const modules = modulesByEntity.get(module.entity) ?? [];
      modules.push({ id: module.id, actions: new Set(module.actions) });
      modulesByEntity.set(module.entity, modules);
    }
    for (const entity of blueprint.entities ?? []) {
      const table = schema.entityTables[entity.id];
      if (!table) throw new AppError('BLUEPRINT_INCOMPATIBLE', `Entity '${entity.id}' has no table.`);
      entities.set(entity.id, {
        entity,
        table,
        fields: new Map(entity.fields.map((field) => [field.id, field])),
        modules: Object.freeze(modulesByEntity.get(entity.id) ?? [])
      });
    }
    this.#entities = entities;
    this.#rolePermissions = new Map(
      (blueprint.roles ?? []).map((role) => [role.id, new Set(role.permissions)] as const)
    );
  }

  list(entityId: string, query: ListQuery, actor: ActorDto): PageDto<EntityRecordDto> {
    void actor;
    const metadata = this.#metadata(entityId);
    const page = Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
    const requestedSize = Number.isInteger(query.pageSize) && query.pageSize > 0 ? query.pageSize : 20;
    const pageSize = Math.min(requestedSize, 100);
    const values: SQLInputValue[] = [];
    const clauses: string[] = [];

    if (query.keyword?.trim()) {
      const searchable = metadata.entity.fields.filter((field) => (
        field.type === 'text' || field.type === 'enum' || field.type === 'reference'
      ));
      if (searchable.length > 0) {
        clauses.push(`(${searchable.map((field) => `${quoteIdentifier(field.id)} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
        const keyword = `%${escapeLike(query.keyword.trim())}%`;
        for (let index = 0; index < searchable.length; index += 1) values.push(keyword);
      }
    }
    for (const filter of query.filters ?? []) {
      const field = metadata.fields.get(filter.field);
      if (!field) throw new AppError('VALIDATION_FAILED', `Unknown filter field '${filter.field}'.`);
      const column = quoteIdentifier(field.id);
      if (filter.operator === 'in') {
        if (!Array.isArray(filter.value) || filter.value.length === 0) {
          throw new AppError('VALIDATION_FAILED', `Filter '${filter.field}' requires a non-empty array.`);
        }
        clauses.push(`${column} IN (${filter.value.map(() => '?').join(', ')})`);
        for (const item of filter.value) values.push(toSqlValue(field, item));
      } else {
        const operators: Record<Exclude<FilterOperator, 'in'>, string> = {
          eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<='
        };
        clauses.push(`${column} ${operators[filter.operator]} ?`);
        values.push(toSqlValue(field, filter.value));
      }
    }

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const count = this.#database.prepare(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(metadata.table)}${where}`
    ).get(...values) as { count: number };
    const sortField = query.sort?.field ?? 'id';
    if (sortField !== 'id' && sortField !== 'version' && !metadata.fields.has(sortField)) {
      throw new AppError('VALIDATION_FAILED', `Unknown sort field '${sortField}'.`);
    }
    const direction = query.sort?.direction === 'asc' ? 'ASC' : 'DESC';
    const rows = this.#database.prepare(
      `SELECT * FROM ${quoteIdentifier(metadata.table)}${where} ORDER BY ${quoteIdentifier(sortField)} ${direction}, "id" ASC LIMIT ? OFFSET ?`
    ).all(...values, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    return Object.freeze({
      items: Object.freeze(rows.map((row) => this.#toDto(metadata, row))),
      page,
      pageSize,
      total: count.count
    });
  }

  get(entityId: string, id: number, actor: ActorDto): EntityRecordDto {
    void actor;
    const metadata = this.#metadata(entityId);
    const row = this.#database.prepare(
      `SELECT * FROM ${quoteIdentifier(metadata.table)} WHERE "id" = ?`
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AppError('NOT_FOUND', '记录不存在。');
    return this.#toDto(metadata, row);
  }

  create(
    entityId: string,
    input: Readonly<Record<string, unknown>>,
    actor: ActorDto
  ): EntityRecordDto {
    const metadata = this.#metadata(entityId);
    this.#requireGenericWrite(metadata, 'create', actor);
    const values = this.#validateInput(metadata, input, true);
    const now = new Date().toISOString();
    const columns = [...values.keys(), 'created_at', 'updated_at'];
    const sqlValues: SQLInputValue[] = [...values.entries()].map(([fieldId, value]) => (
      toSqlValue(metadata.fields.get(fieldId)!, value)
    ));
    sqlValues.push(now, now);
    try {
      const result = this.#database.prepare(
        `INSERT INTO ${quoteIdentifier(metadata.table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
      ).run(...sqlValues);
      return this.get(entityId, Number(result.lastInsertRowid), actor);
    } catch (error) {
      return mapWriteError(error);
    }
  }

  update(
    entityId: string,
    id: number,
    expectedVersion: number,
    input: Readonly<Record<string, unknown>>,
    actor: ActorDto
  ): EntityRecordDto {
    const metadata = this.#metadata(entityId);
    this.#requireGenericWrite(metadata, 'update', actor);
    const values = this.#validateInput(metadata, input, false);
    if (values.size === 0) throw new AppError('VALIDATION_FAILED', '没有可更新的字段。');
    const assignments = [...values.keys()].map((fieldId) => `${quoteIdentifier(fieldId)} = ?`);
    const sqlValues: SQLInputValue[] = [...values.entries()].map(([fieldId, value]) => (
      toSqlValue(metadata.fields.get(fieldId)!, value)
    ));
    assignments.push('"updated_at" = ?', '"version" = "version" + 1');
    sqlValues.push(new Date().toISOString(), id, expectedVersion);
    try {
      const result = this.#database.prepare(
        `UPDATE ${quoteIdentifier(metadata.table)} SET ${assignments.join(', ')} WHERE "id" = ? AND "version" = ?`
      ).run(...sqlValues);
      if (Number(result.changes) === 0) {
        const exists = this.#database.prepare(
          `SELECT 1 AS found FROM ${quoteIdentifier(metadata.table)} WHERE "id" = ?`
        ).get(id);
        if (!exists) throw new AppError('NOT_FOUND', '记录不存在。');
        throw new AppError('VERSION_CONFLICT', '记录已被其他操作更新。');
      }
      return this.get(entityId, id, actor);
    } catch (error) {
      if (error instanceof AppError) throw error;
      return mapWriteError(error);
    }
  }

  #metadata(entityId: string): EntityMetadata {
    const metadata = this.#entities.get(entityId);
    if (!metadata) throw new AppError('VALIDATION_FAILED', `Unknown entity '${entityId}'.`);
    return metadata;
  }

  #requireGenericWrite(
    metadata: EntityMetadata,
    action: 'create' | 'update',
    actor: ActorDto
  ): void {
    const protectedHistory = metadata.entity.systemManaged || (
      action === 'update' && metadata.entity.history
    );
    const rolePermissions = this.#rolePermissions.get(actor.roleId);
    const authorized = metadata.modules.some((module) => (
      module.actions.has(action) && rolePermissions?.has(`${module.id}.${action}`)
    ));
    if (protectedHistory || !authorized) {
      throw new AppError('PERMISSION_DENIED', 'This record can only be changed through its domain action.');
    }
  }

  #validateInput(
    metadata: EntityMetadata,
    input: Readonly<Record<string, unknown>>,
    creating: boolean
  ): Map<string, JsonValue> {
    const fieldErrors: FieldError[] = [];
    for (const key of Object.keys(input)) {
      if (!metadata.fields.has(key)) fieldErrors.push({ field: key, message: '未知字段' });
    }
    if (creating) {
      for (const field of metadata.entity.fields) {
        if (field.required && !Object.hasOwn(field, 'default') && !Object.hasOwn(input, field.id)) {
          fieldErrors.push({ field: field.id, message: '不能为空' });
        }
      }
    }
    const values = new Map<string, JsonValue>();
    for (const [key, raw] of Object.entries(input)) {
      const field = metadata.fields.get(key);
      if (!field) continue;
      const error = validateValue(field, raw);
      if (error) fieldErrors.push(error);
      else values.set(key, raw as JsonValue);
    }
    if (fieldErrors.length > 0) {
      throw new AppError('VALIDATION_FAILED', '输入未通过校验。', { fieldErrors });
    }
    return values;
  }

  #toDto(metadata: EntityMetadata, row: Record<string, unknown>): EntityRecordDto {
    const values: Record<string, JsonValue> = {};
    for (const field of metadata.entity.fields) {
      values[field.id] = fromSqlValue(field, row[field.id]);
    }
    return Object.freeze({
      id: Number(row.id),
      version: Number(row.version),
      values: Object.freeze(values)
    });
  }
}
