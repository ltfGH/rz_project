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
  readonly scope: 'module' | 'record';
}

export type DashboardTone = 'neutral' | 'teal' | 'amber' | 'red';

export interface DashboardMetricDto {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly tone: DashboardTone;
}

export interface DashboardItemDto {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly tone: DashboardTone;
  readonly moduleId?: string;
}

export interface DashboardGroupDto {
  readonly id: string;
  readonly label: string;
  readonly kind: 'status' | 'attention';
  readonly items: readonly DashboardItemDto[];
}

export interface DashboardSectionDto {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly groups: readonly DashboardGroupDto[];
}

export interface DashboardSnapshotDto {
  readonly metrics: readonly DashboardMetricDto[];
  readonly sections: readonly DashboardSectionDto[];
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
