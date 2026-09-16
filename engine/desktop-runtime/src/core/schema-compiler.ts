import { createHash } from 'node:crypto';

import type {
  JsonValue,
  RuntimeBlueprint,
  RuntimeEntity,
  RuntimeField
} from '../shared/blueprint';
import { AppError } from '../shared/errors';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export interface CompiledSchema {
  readonly version: number;
  readonly digest: string;
  readonly migrations: readonly Migration[];
  readonly entityTables: Readonly<Record<string, string>>;
  readonly systemTables: readonly string[];
}

const IDENTIFIER = /^[a-z][a-z0-9_]{1,63}$/;
const SYSTEM_TABLES = Object.freeze([
  'sys_migration',
  'sys_user',
  'sys_session',
  'sys_workflow_event',
  'sys_audit_event',
  'sys_metadata',
  'sys_backup_manifest'
]);

function reject(message: string): never {
  throw new AppError('BLUEPRINT_INCOMPATIBLE', message);
}

function assertIdentifier(value: string, description: string): void {
  if (!IDENTIFIER.test(value)) reject(`Unsafe ${description} identifier '${value}'.`);
}

function identifier(value: string): string {
  return `"${value}"`;
}

function stringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlType(field: RuntimeField): string {
  switch (field.type) {
    case 'integer':
    case 'boolean':
      return 'INTEGER';
    case 'decimal':
      return 'REAL';
    case 'text':
    case 'date':
    case 'datetime':
    case 'enum':
    case 'reference':
      return 'TEXT';
  }
}

function validateDefault(field: RuntimeField, value: JsonValue): void {
  const valid = (() => {
    switch (field.type) {
      case 'boolean': return typeof value === 'boolean';
      case 'integer': return typeof value === 'number' && Number.isInteger(value);
      case 'decimal': return typeof value === 'number' && Number.isFinite(value);
      case 'enum': return typeof value === 'string' && Boolean(field.options?.includes(value));
      case 'text':
      case 'date':
      case 'datetime':
      case 'reference':
        return typeof value === 'string';
    }
  })();
  if (!valid) reject(`Default for '${field.id}' does not match type '${field.type}'.`);
}

function defaultSql(field: RuntimeField): string | undefined {
  if (!Object.hasOwn(field, 'default')) return undefined;
  const value = field.default as JsonValue;
  validateDefault(field, value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return stringLiteral(value);
  return reject(`Default for '${field.id}' cannot be represented in SQLite.`);
}

function compileField(field: RuntimeField): string {
  assertIdentifier(field.id, 'field');
  const parts = [identifier(field.id), sqlType(field)];
  if (field.required) parts.push('NOT NULL');
  if (field.unique) parts.push('UNIQUE');
  const defaultValue = defaultSql(field);
  if (defaultValue !== undefined) parts.push(`DEFAULT ${defaultValue}`);
  if (field.type === 'boolean') {
    parts.push(`CHECK (${identifier(field.id)} IN (0, 1))`);
  }
  if (field.type === 'enum') {
    if (!field.options || field.options.length === 0) reject(`Enum '${field.id}' has no options.`);
    parts.push(`CHECK (${identifier(field.id)} IN (${field.options.map(stringLiteral).join(', ')}))`);
  }
  return parts.join(' ');
}

function businessTable(entityId: string): string {
  return `biz_${entityId}`;
}

function compileEntity(
  entity: RuntimeEntity,
  entities: ReadonlyMap<string, RuntimeEntity>
): readonly string[] {
  assertIdentifier(entity.id, 'entity');
  const table = businessTable(entity.id);
  const fieldIds = new Set<string>();
  const definitions = ['"id" INTEGER PRIMARY KEY AUTOINCREMENT'];
  for (const field of entity.fields) {
    if (fieldIds.has(field.id)) reject(`Duplicate field '${entity.id}.${field.id}'.`);
    fieldIds.add(field.id);
    definitions.push(compileField(field));
  }
  definitions.push('"version" INTEGER NOT NULL DEFAULT 1');
  definitions.push('"created_at" TEXT NOT NULL');
  definitions.push('"updated_at" TEXT NOT NULL');

  const indexes: string[] = [];
  for (const relation of entity.relations) {
    assertIdentifier(relation.id, 'relation');
    assertIdentifier(relation.field, 'relation field');
    assertIdentifier(relation.targetEntity, 'relation target entity');
    assertIdentifier(relation.targetField, 'relation target field');
    if (!fieldIds.has(relation.field)) reject(`Relation '${relation.id}' has no source field.`);
    const target = entities.get(relation.targetEntity);
    if (!target || !target.fields.some((field) => field.id === relation.targetField)) {
      reject(`Relation '${relation.id}' has no valid target field.`);
    }
    definitions.push(
      `FOREIGN KEY (${identifier(relation.field)}) REFERENCES ${identifier(businessTable(relation.targetEntity))} (${identifier(relation.targetField)}) ON DELETE ${relation.onDelete.toUpperCase().replace('_', ' ')}`
    );
    indexes.push(
      `CREATE INDEX ${identifier(`idx_${entity.id}_${relation.field}`)} ON ${identifier(table)} (${identifier(relation.field)});`
    );
  }

  return [
    `CREATE TABLE ${identifier(table)} (\n  ${definitions.join(',\n  ')}\n);`,
    ...indexes
  ];
}

function systemStatements(): readonly string[] {
  return [
    'CREATE TABLE "sys_migration" ("version" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "digest" TEXT NOT NULL, "applied_at" TEXT NOT NULL);',
    'CREATE TABLE "sys_user" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "username" TEXT NOT NULL UNIQUE, "display_name" TEXT NOT NULL, "role_id" TEXT NOT NULL, "password_digest" TEXT NOT NULL, "enabled" INTEGER NOT NULL DEFAULT 1, "failed_attempts" INTEGER NOT NULL DEFAULT 0, "locked_until" TEXT, "version" INTEGER NOT NULL DEFAULT 1, "created_at" TEXT NOT NULL, "updated_at" TEXT NOT NULL);',
    'CREATE TABLE "sys_session" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "user_id" INTEGER NOT NULL, "token_digest" TEXT NOT NULL UNIQUE, "expires_at" TEXT NOT NULL, "created_at" TEXT NOT NULL, FOREIGN KEY ("user_id") REFERENCES "sys_user" ("id") ON DELETE CASCADE);',
    'CREATE TABLE "sys_workflow_event" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "workflow_id" TEXT NOT NULL, "entity_id" TEXT NOT NULL, "record_id" INTEGER NOT NULL, "transition_id" TEXT NOT NULL, "from_state" TEXT NOT NULL, "to_state" TEXT NOT NULL, "actor_id" INTEGER NOT NULL, "created_at" TEXT NOT NULL);',
    'CREATE TABLE "sys_audit_event" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "actor_id" INTEGER, "actor_name" TEXT NOT NULL, "permission" TEXT NOT NULL, "entity_id" TEXT, "record_id" INTEGER, "result" TEXT NOT NULL, "detail_json" TEXT NOT NULL, "app_version" TEXT NOT NULL, "created_at" TEXT NOT NULL);',
    'CREATE TABLE "sys_metadata" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL, "updated_at" TEXT NOT NULL);',
    'CREATE TABLE "sys_backup_manifest" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "file_name" TEXT NOT NULL UNIQUE, "sha256" TEXT NOT NULL, "schema_version" INTEGER NOT NULL, "app_version" TEXT NOT NULL, "created_by" INTEGER, "created_at" TEXT NOT NULL);'
  ];
}

export function compileSchema(blueprint: RuntimeBlueprint): CompiledSchema {
  const entities = blueprint.entities;
  if (!entities || entities.length === 0) reject('Blueprint must contain at least one entity.');
  const entityMap = new Map<string, RuntimeEntity>();
  for (const entity of entities) {
    assertIdentifier(entity.id, 'entity');
    if (entityMap.has(entity.id)) reject(`Duplicate entity '${entity.id}'.`);
    entityMap.set(entity.id, entity);
  }

  const statements = [...systemStatements()];
  for (const entity of entities) statements.push(...compileEntity(entity, entityMap));
  const digest = createHash('sha256').update(JSON.stringify(statements), 'utf8').digest('hex');
  const entityTables = Object.freeze(Object.fromEntries(
    entities.map((entity) => [entity.id, businessTable(entity.id)])
  ));
  const migration = Object.freeze({
    version: 1,
    name: 'initial_blueprint_schema',
    statements: Object.freeze(statements)
  });
  return Object.freeze({
    version: 1,
    digest,
    migrations: Object.freeze([migration]),
    entityTables,
    systemTables: SYSTEM_TABLES
  });
}
