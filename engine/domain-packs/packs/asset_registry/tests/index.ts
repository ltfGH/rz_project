import type { DatabaseSync } from 'node:sqlite';

import type { RuntimeDatabase } from '../../../../desktop-runtime/src/core/database';
import type { DashboardService } from '../../../../desktop-runtime/src/core/dashboard-service';
import type { EntityRepository } from '../../../../desktop-runtime/src/core/entity-repository';
import type { ActorDto } from '../../../../desktop-runtime/src/shared/dto';
import {
  type AssetLifecycleContext,
  type AssetLifecycleService
} from '../runtime/index';

export interface AssetAcceptanceDependencies {
  readonly database: RuntimeDatabase;
  readonly repository: EntityRepository;
  readonly lifecycle: AssetLifecycleService;
  readonly dashboard: DashboardService;
  readonly actor: ActorDto;
  readonly context: (connection: DatabaseSync) => AssetLifecycleContext;
}

export interface AssetAcceptanceResult {
  readonly metrics: Readonly<{
    total: number;
    active: number;
    maintenance: number;
  }>;
  readonly responsibilityCount: number;
  readonly eventCount: number;
  readonly auditCount: number;
  readonly assetVersion: number;
}

export function runAssetAcceptanceScenario(
  dependencies: AssetAcceptanceDependencies
): AssetAcceptanceResult {
  const { database, repository, lifecycle, dashboard, actor } = dependencies;
  repository.create('asset_category', {
    code: 'ACC-CAT-001', name: '验收设备', active: true
  }, actor);
  const primary = repository.create('asset', {
    code: 'ACC-AST-001', name: '验收资产一', category_code: 'ACC-CAT-001',
    status: 'active', location: '验收区-A'
  }, actor);
  repository.create('asset', {
    code: 'ACC-AST-002', name: '验收资产二', category_code: 'ACC-CAT-001',
    status: 'active', location: '验收区-B'
  }, actor);

  const responsibility = database.transaction((connection) => lifecycle.assignResponsibility({
    assetId: primary.id,
    expectedVersion: primary.version,
    responsibilityCode: 'ACC-RESP-001',
    assignee: '责任岗位-01',
    reason: '验收责任分配'
  }, dependencies.context(connection)));
  const lifecycleResult = database.transaction((connection) => lifecycle.changeStatus({
    assetId: primary.id,
    expectedVersion: responsibility.assetVersion,
    nextStatus: 'maintenance',
    reason: '验收维护'
  }, dependencies.context(connection)));

  const metricValues = new Map(
    dashboard.read(actor).map((metric) => [metric.id, metric.value] as const)
  );
  const responsibilityCount = database.prepare(
    'SELECT COUNT(*) AS count FROM biz_asset_responsibility'
  ).get() as { count: number };
  const eventCount = database.prepare(
    'SELECT COUNT(*) AS count FROM biz_asset_event'
  ).get() as { count: number };
  const auditCount = database.prepare(
    'SELECT COUNT(*) AS count FROM sys_audit_event'
  ).get() as { count: number };

  return Object.freeze({
    metrics: Object.freeze({
      total: metricValues.get('asset_total') ?? 0,
      active: metricValues.get('asset_active') ?? 0,
      maintenance: metricValues.get('asset_maintenance') ?? 0
    }),
    responsibilityCount: Number(responsibilityCount.count),
    eventCount: Number(eventCount.count),
    auditCount: Number(auditCount.count),
    assetVersion: lifecycleResult.version
  });
}

export const assetAcceptanceDescriptor = Object.freeze({
  id: 'asset_registry',
  version: '1.0.0',
  scenarios: Object.freeze(['asset.lifecycle.acceptance'])
});
