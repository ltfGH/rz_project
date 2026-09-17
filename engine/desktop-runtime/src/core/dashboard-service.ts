import type { SQLInputValue } from 'node:sqlite';

import type { RuntimeBlueprint } from '../shared/blueprint';
import type { ActorDto } from '../shared/dto';
import { AppError } from '../shared/errors';
import type { RuntimeDatabase } from './database';
import type { CompiledSchema } from './schema-compiler';

interface DashboardDefinition {
  readonly id: string;
  readonly name: string;
  readonly entity: string;
  readonly aggregation: 'count' | 'sum' | 'average' | 'minimum' | 'maximum';
  readonly field?: string;
  readonly filters: readonly { field: string; operator: string; value: unknown }[];
}

export interface DashboardMetric {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly tone: 'teal' | 'amber' | 'red' | 'neutral';
}

const identifier = (value: string) => {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(value)) throw new AppError('BLUEPRINT_INCOMPATIBLE', '仪表盘标识符无效。');
  return `"${value}"`;
};

export class DashboardService {
  constructor(
    private readonly database: RuntimeDatabase,
    private readonly blueprint: RuntimeBlueprint,
    private readonly schema: CompiledSchema
  ) {}

  read(actor: ActorDto): readonly DashboardMetric[] {
    void actor;
    return Object.freeze((this.blueprint.dashboards ?? []).map((raw, index) => {
      const item = raw as unknown as DashboardDefinition;
      const table = this.schema.entityTables[item.entity];
      if (!table) throw new AppError('BLUEPRINT_INCOMPATIBLE', `仪表盘实体 '${item.entity}' 不存在。`);
      const values: SQLInputValue[] = [];
      const clauses = item.filters.map((filter) => {
        const operators: Record<string, string> = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
        const operator = operators[filter.operator];
        if (!operator) throw new AppError('BLUEPRINT_INCOMPATIBLE', '仪表盘筛选操作不受支持。');
        values.push(filter.value as SQLInputValue);
        return `${identifier(filter.field)} ${operator} ?`;
      });
      const aggregates = { count: 'COUNT(*)', sum: 'SUM', average: 'AVG', minimum: 'MIN', maximum: 'MAX' } as const;
      const expression = item.aggregation === 'count'
        ? aggregates.count
        : `${aggregates[item.aggregation]}(${identifier(item.field ?? '')})`;
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const row = this.database.prepare(
        `SELECT COALESCE(${expression}, 0) AS value FROM ${identifier(table)}${where}`
      ).get(...values) as { value: number };
      const tones = ['teal', 'amber', 'red'] as const;
      return Object.freeze({ id: item.id, name: item.name, value: Number(row.value), tone: tones[index] ?? 'neutral' });
    }));
  }
}
