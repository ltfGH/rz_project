import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { ActivatedPluginHost, PluginContribution } from './plugin-host';
import type { RuntimeDatabase } from './database';
import type { PermissionService } from './permission-service';
import type { RuntimeBlueprint, JsonValue } from '../shared/blueprint';
import type { ActorDto } from '../shared/dto';
import { AppError, type AppErrorCode } from '../shared/errors';

type Payload = Readonly<Record<string, JsonValue>>;

interface Action {
  readonly id: string;
  readonly permission: string;
  readonly parse: (payload: Payload) => Payload;
  readonly execute: (context: ActionContext, payload: Payload) => unknown;
}

interface CommandDefinition {
  readonly id: string;
  readonly allowedSources: readonly string[];
  readonly parse: (payload: Payload) => Payload;
  readonly execute: (
    context: { connection: DatabaseSync; actor: ActorDto; sourcePluginId: string },
    payload: Payload
  ) => unknown;
}

interface ActionContext {
  readonly connection: DatabaseSync;
  readonly actor: ActorDto;
  readonly config: Payload;
  readonly pluginConfig: (id: string) => Payload;
  readonly requirePermission: (actor: ActorDto, permission: string) => void;
  readonly appendAudit: (connection: DatabaseSync, event: unknown) => void;
  readonly identityHasRole: (identityId: string, roleId: string, connection: DatabaseSync) => boolean;
  readonly identityExists: (identityId: string, connection: DatabaseSync) => boolean;
  readonly extensions: { values<T>(group: string): readonly T[] };
  readonly commandBus: { invoke(id: string, payload: Payload): unknown };
  readonly now: () => Date;
  readonly nextCode: (namespace: string) => string;
}

interface Options {
  readonly database: () => RuntimeDatabase;
  readonly blueprint: RuntimeBlueprint;
  readonly plugins: ActivatedPluginHost;
  readonly permissions: PermissionService;
  readonly audit?: { append(connection: DatabaseSync, event: any): void };
}

const CODES = new Set<AppErrorCode>([
  'VALIDATION_FAILED', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND',
  'UNIQUE_CONFLICT', 'VERSION_CONFLICT', 'INVALID_TRANSITION', 'IMPORT_FAILED',
  'BACKUP_FAILED', 'RESTORE_FAILED', 'BLUEPRINT_INCOMPATIBLE',
  'DATABASE_MIGRATION_FAILED', 'INTERNAL_ERROR'
]);

const GROUP_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  'asset.lifecycle.blockers': 'asset.deactivation.',
  'inspection.archive.blockers': 'inspection.archive.',
  'project.close.blockers': 'project.close.',
  'inventory.issue.blockers': 'inventory.issue.',
  'inspection.abnormal.handlers': 'inspection.abnormal.',
  'application.approval.handlers': 'application.approval.'
});

function normalize(value: unknown, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AppError('VALIDATION_FAILED', '领域动作参数必须是有限数字。');
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    throw new AppError('VALIDATION_FAILED', '领域动作参数必须是无环 JSON 数据。');
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new AppError('VALIDATION_FAILED', '领域动作参数必须是普通 JSON 数据。');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => normalize(item, seen))) as unknown as JsonValue;
    }
    const output = Object.create(null) as Record<string, JsonValue>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set || !('value' in descriptor)) {
        throw new AppError('VALIDATION_FAILED', '领域动作参数必须是普通 JSON 数据。');
      }
      Object.defineProperty(output, key, {
        value: normalize(descriptor.value, seen), enumerable: true, writable: false
      });
    }
    return Object.freeze(output);
  } finally {
    seen.delete(value);
  }
}

function payload(value: unknown): Payload {
  const result = normalize(value);
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new AppError('VALIDATION_FAILED', '领域动作参数必须是 JSON 对象。');
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 64 * 1024) {
    throw new AppError('VALIDATION_FAILED', '领域动作参数不能超过 64 KiB。');
  }
  return result as Payload;
}

function mapped(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error && typeof error === 'object' &&
    typeof (error as any).code === 'string' && CODES.has((error as any).code) &&
    typeof (error as any).message === 'string') {
    return new AppError((error as any).code, (error as any).message);
  }
  return new AppError('INTERNAL_ERROR', '操作失败，请使用日志编号联系管理员。');
}

export class DomainCommandService {
  readonly #options: Options;
  readonly #configs = new Map<string, Payload>();

  constructor(options: Options) {
    this.#options = options;
    for (const selection of options.blueprint.plugins) {
      this.#configs.set(selection.id, selection.config);
    }
  }

  execute(commandId: string, raw: unknown, actor: ActorDto): unknown {
    const contribution = this.#options.plugins.domainActions[commandId];
    if (!contribution) throw new AppError('NOT_FOUND', `Domain action '${commandId}' is not available.`);
    const action = contribution.value as Action;
    if (action.id !== commandId || typeof action.parse !== 'function' || typeof action.execute !== 'function') {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Domain action contribution is invalid.');
    }
    this.#options.permissions.require(actor, action.permission);
    const normalized = payload(raw);
    try {
      return this.#options.database().transaction((connection) => {
        const runtime = this.#runtime(connection, actor);
        return action.execute(runtime.context(contribution), action.parse(normalized));
      });
    } catch (error) {
      throw mapped(error);
    }
  }

  #runtime(connection: DatabaseSync, actor: ActorDto) {
    let definitions: Map<string, CommandDefinition> | undefined;
    const busFor = (sourcePluginId: string) => Object.freeze({
      invoke: (id: string, raw: Payload) => {
        const definition = commands().get(id);
        if (!definition) throw new AppError('BLUEPRINT_INCOMPATIBLE', `Domain command '${id}' is not registered.`);
        if (!definition.allowedSources.includes(sourcePluginId)) {
          throw new AppError('PERMISSION_DENIED', `Domain command '${id}' is not allowed for this source.`);
        }
        return definition.execute(
          { connection, actor, sourcePluginId },
          definition.parse(payload(raw))
        );
      }
    });
    const completionValue = (entry: PluginContribution) => {
      const value = entry.value as any;
      const handler = typeof value === 'function'
        ? value
        : typeof value?.create === 'function'
          ? value.create(this.#configs.get(entry.pluginId) ?? Object.freeze({}))
          : undefined;
      if (typeof handler !== 'function') {
        throw new AppError('BLUEPRINT_INCOMPATIBLE', `Completion handler '${entry.id}' is invalid.`);
      }
      return (dto: unknown) => handler(dto, busFor(entry.pluginId));
    };
    const extensionValues = <T>(group: string): readonly T[] => {
      const completion = group.endsWith('.handlers');
      const source = completion
        ? this.#options.plugins.completionHandlers
        : this.#options.plugins.lifecycleBlockers;
      const prefix = GROUP_PREFIX[group] ?? group;
      return Object.values(source)
        .filter((entry) => entry.id.startsWith(prefix))
        .map((entry) => (completion ? completionValue(entry) : entry.value) as T);
    };
    const context = (owner: PluginContribution): ActionContext => Object.freeze({
      connection,
      actor,
      config: this.#configs.get(owner.pluginId) ?? Object.freeze({}),
      pluginConfig: (id: string) => this.#configs.get(id) ?? Object.freeze({}),
      requirePermission: (current: ActorDto, permission: string) => (
        this.#options.permissions.require(current, permission)
      ),
      appendAudit: (target: DatabaseSync, event: unknown) => this.#options.audit?.append(target, event),
      identityHasRole: (identityId: string, roleId: string, target: DatabaseSync) => {
        const row = target.prepare(
          'SELECT role_id FROM sys_user WHERE username=? AND enabled=1'
        ).get(identityId) as { role_id: string } | undefined;
        return Boolean(row && this.#options.permissions.roleIncludes(row.role_id, roleId));
      },
      identityExists: (identityId: string, target: DatabaseSync) => Boolean(target.prepare(
        'SELECT 1 FROM sys_user WHERE username=? AND enabled=1'
      ).get(identityId)),
      extensions: Object.freeze({ values: extensionValues }),
      commandBus: busFor(owner.pluginId),
      now: () => new Date(),
      nextCode: (namespace: string) => `${namespace.toUpperCase()}-${randomUUID()}`
    });
    const commands = () => {
      if (definitions) return definitions;
      definitions = new Map();
      for (const entry of Object.values(this.#options.plugins.domainCommands)) {
        const factory = (entry.value as any)?.createDefinition;
        if (typeof factory !== 'function') {
          throw new AppError('BLUEPRINT_INCOMPATIBLE', `Domain command contribution '${entry.id}' is invalid.`);
        }
        const definition = factory(context(entry)) as CommandDefinition;
        if (definitions.has(definition.id)) {
          throw new AppError('BLUEPRINT_INCOMPATIBLE', `Domain command '${definition.id}' is registered more than once.`);
        }
        definitions.set(definition.id, definition);
      }
      return definitions;
    };
    return { context };
  }
}
