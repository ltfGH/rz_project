import type { DatabaseSync } from 'node:sqlite';

import type { JsonValue } from '../shared/types';

export type JsonObject = Readonly<Record<string, JsonValue>>;

export interface DomainCommandActor {
  readonly userId: number;
  readonly username: string;
  readonly displayName: string;
  readonly roleId: string;
}

export interface DomainCommandExecutionContext {
  readonly connection: DatabaseSync;
  readonly actor: DomainCommandActor;
  readonly sourcePluginId: string;
}

export interface DomainCommandDefinition {
  readonly id: string;
  readonly allowedSources: readonly string[];
  readonly parse: (payload: JsonObject) => JsonObject;
  readonly execute: (
    context: DomainCommandExecutionContext,
    payload: JsonObject
  ) => JsonValue | void;
}

export interface DomainCommandBus {
  invoke(commandId: string, payload: JsonObject): JsonValue | void;
}
