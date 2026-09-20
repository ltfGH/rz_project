import type { JsonValue } from './blueprint';

export interface ActorDto {
  readonly userId: number;
  readonly username: string;
  readonly displayName: string;
  readonly roleId: string;
}

export interface DomainActionDto {
  readonly id: string;
  readonly label: string;
  readonly entityId: string;
  readonly order: number;
}

export interface PageDto<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface EntityRecordDto {
  readonly id: number;
  readonly version: number;
  readonly values: Readonly<Record<string, JsonValue>>;
}

export interface AllowedTransitionDto {
  readonly workflowId: string;
  readonly transitionId: string;
  readonly name: string;
  readonly allowed: boolean;
  readonly reason?: string;
}
