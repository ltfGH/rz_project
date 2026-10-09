import { z } from 'zod';

import type { RuntimeBlueprint } from '../shared/blueprint';
import type { DashboardGroupDto, DashboardItemDto, DashboardSectionDto } from '../shared/dto';
import { AppError } from '../shared/errors';
import type { PluginContribution } from './plugin-host';

const id = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const dottedId = z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
const sourceKey = z.string().regex(/^[a-z][A-Za-z0-9]{1,63}$/);
const display = z.string().trim().min(1).max(80);
const tone = z.enum(['neutral', 'teal', 'amber', 'red']);

const itemSchema = z.object({
  id, sourceKey, label:display, tone, moduleId:id.optional()
}).strict();
const groupSchema = z.object({
  id, label:display, kind:z.enum(['status', 'attention']), items:z.array(itemSchema).min(1).max(12)
}).strict();
const sectionSchema = z.object({
  id:dottedId, slot:z.literal('dashboard.sections'), label:display,
  order:z.number().int().min(0).max(10_000), viewId:id, dataSource:dottedId,
  presentation:z.object({ groups:z.array(groupSchema).min(1).max(3) }).strict()
}).strict();

interface DomainAction {
  readonly id: string;
  readonly permission: string;
  readonly parse: (payload: Readonly<Record<string, never>>) => unknown;
  readonly execute: (...args: readonly unknown[]) => unknown;
}

export interface DashboardItemDefinition {
  readonly id: string;
  readonly sourceKey: string;
  readonly label: string;
  readonly tone: 'neutral' | 'teal' | 'amber' | 'red';
  readonly moduleId?: string;
}

export interface DashboardGroupDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: 'status' | 'attention';
  readonly items: readonly DashboardItemDefinition[];
}

export interface DashboardSectionDefinition {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly dataSource: string;
  readonly groups: readonly DashboardGroupDefinition[];
}

function incompatible(): never {
  throw new AppError('BLUEPRINT_INCOMPATIBLE', '仪表盘扩展定义与当前运行时不兼容。');
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function parseDashboardContributions(
  uiExtensions: Readonly<Record<string, PluginContribution>>,
  domainActions: Readonly<Record<string, PluginContribution>>,
  blueprint: RuntimeBlueprint
): readonly DashboardSectionDefinition[] {
  const modules = new Set((blueprint.modules ?? []).map((module) => module.id));
  const definitions: DashboardSectionDefinition[] = [];
  for (const contribution of Object.values(uiExtensions)) {
    const candidate = contribution.value as { slot?: unknown };
    if (candidate?.slot !== 'dashboard.sections') continue;
    const parsed = sectionSchema.safeParse(contribution.value);
    if (!parsed.success || contribution.id !== parsed.data.id) incompatible();
    const groups = parsed.data.presentation.groups;
    if (!unique(groups.map((group) => group.id)) ||
      groups.some((group) => !unique(group.items.map((item) => item.id)))) incompatible();
    for (const group of groups) {
      for (const item of group.items) {
        if (item.moduleId && !modules.has(item.moduleId)) incompatible();
      }
    }
    const actionContribution = domainActions[parsed.data.dataSource];
    const action = actionContribution?.value as DomainAction | undefined;
    if (!actionContribution || actionContribution.id !== parsed.data.dataSource ||
      action?.id !== parsed.data.dataSource || typeof action.permission !== 'string' ||
      typeof action.parse !== 'function' || typeof action.execute !== 'function') incompatible();
    try { action.parse(Object.freeze({})); } catch { incompatible(); }
    const normalizedGroups: DashboardGroupDefinition[] = groups.map((group) => ({
      id:group.id, label:group.label, kind:group.kind,
      items:group.items.map((item) => {
        const normalized: {
          id:string;sourceKey:string;label:string;tone:DashboardItemDefinition['tone'];moduleId?:string
        } = { id:item.id, sourceKey:item.sourceKey, label:item.label, tone:item.tone };
        if (item.moduleId) normalized.moduleId = item.moduleId;
        return normalized;
      })
    }));
    definitions.push({
      id:parsed.data.viewId, label:parsed.data.label, order:parsed.data.order,
      dataSource:parsed.data.dataSource, groups:normalizedGroups
    });
  }
  definitions.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return freeze(definitions);
}

export function normalizeDashboardSection(
  definition: DashboardSectionDefinition,
  raw: unknown
): DashboardSectionDto {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) incompatible();
  const values = raw as Record<string, unknown>;
  const groups: DashboardGroupDto[] = definition.groups.map((group) => ({
    id:group.id, label:group.label, kind:group.kind,
    items:group.items.map((item): DashboardItemDto => {
      const value = values[item.sourceKey];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) incompatible();
      const normalized = { id:item.id, label:item.label, value, tone:item.tone } as {
        id:string;label:string;value:number;tone:DashboardItemDto['tone'];moduleId?:string
      };
      if (item.moduleId) normalized.moduleId = item.moduleId;
      return normalized;
    })
  }));
  return freeze({ id:definition.id, label:definition.label, order:definition.order, groups });
}
