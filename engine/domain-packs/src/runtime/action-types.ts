import type { DatabaseSync } from 'node:sqlite';

import { AppError } from '../../../desktop-runtime/src/shared/errors';
import type { PluginContributionSink } from '../../../desktop-runtime/src/core/plugin-registry';
import type { JsonValue } from '../shared/types';
import type { DomainCommandActor, DomainCommandBus, JsonObject } from './types';

export interface PluginActionExtensions {
  values<T>(extensionId: string): readonly T[];
}

export interface PluginActionContext {
  readonly connection: DatabaseSync;
  readonly actor: DomainCommandActor;
  readonly config: JsonObject;
  readonly pluginConfig: (pluginId: string) => JsonObject;
  readonly requirePermission: (actor: DomainCommandActor, permission: string) => void;
  readonly appendAudit: (connection: DatabaseSync, entry: unknown) => void;
  readonly identityHasRole: (identityId: string, roleId: string, connection: DatabaseSync) => boolean;
  readonly identityExists: (identityId: string, connection: DatabaseSync) => boolean;
  readonly extensions: PluginActionExtensions;
  readonly commandBus: DomainCommandBus;
  readonly archiveStore?: unknown;
  readonly now: () => Date;
  readonly nextCode: (namespace: string) => string;
}

export interface PluginDomainAction {
  readonly id: string;
  readonly permission: string;
  readonly parse: (payload: JsonObject) => JsonObject;
  readonly execute: (context: PluginActionContext, payload: JsonObject) => JsonValue | void;
}

export interface ServiceActionBinding {
  readonly id: string;
  readonly method: string;
  readonly permission: string;
  readonly invocation?: 'request' | 'context';
  readonly idField?: string;
}

function parsedPayload(binding: ServiceActionBinding, payload: JsonObject): JsonObject {
  if (binding.invocation === 'context') {
    if (Object.keys(payload).length > 0) {
      throw new AppError('VALIDATION_FAILED', `Action '${binding.id}' does not accept input.`);
    }
    return payload;
  }
  if (binding.idField) {
    if (Object.keys(payload).length !== 1 || !Object.hasOwn(payload, binding.idField)) {
      throw new AppError('VALIDATION_FAILED', `Action '${binding.id}' requires '${binding.idField}'.`);
    }
    const value = payload[binding.idField];
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      throw new AppError('VALIDATION_FAILED', `'${binding.idField}' must be a positive integer.`);
    }
  }
  return payload;
}

export function createServiceActions<TService, TContext>(
  service: TService,
  createContext: (context: PluginActionContext) => TContext,
  bindings: readonly ServiceActionBinding[]
): readonly PluginDomainAction[] {
  const methods = service as Record<string, unknown>;
  return Object.freeze(bindings.map((binding) => {
    const method = methods[binding.method];
    if (typeof method !== 'function') {
      throw new AppError(
        'BLUEPRINT_INCOMPATIBLE',
        `Action '${binding.id}' references missing service method '${binding.method}'.`
      );
    }
    return Object.freeze({
      id: binding.id,
      permission: binding.permission,
      parse: (payload: JsonObject) => parsedPayload(binding, payload),
      execute: (context: PluginActionContext, payload: JsonObject) => {
        const domainContext = createContext(context);
        let result: unknown;
        if (binding.invocation === 'context') {
          result = method.call(service, domainContext);
        } else if (binding.idField) {
          result = method.call(service, Number(payload[binding.idField]), domainContext);
        } else {
          result = method.call(service, payload, domainContext);
        }
        return result as JsonValue | void;
      }
    });
  }));
}

export function registerPluginActions(
  sink: PluginContributionSink,
  pluginId: string,
  actions: readonly PluginDomainAction[]
): void {
  for (const action of actions) sink.register(pluginId, action.id, action);
}
