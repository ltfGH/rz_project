import type { DatabaseSync } from 'node:sqlite';

import type { RuntimeDatabase } from '../../../../desktop-runtime/src/core/database';
import type { DashboardService } from '../../../../desktop-runtime/src/core/dashboard-service';
import type { EntityRepository } from '../../../../desktop-runtime/src/core/entity-repository';
import type { ActorDto } from '../../../../desktop-runtime/src/shared/dto';
import type { WorkOrderContext } from '../runtime/types';
import type { WorkOrderService } from '../runtime/work-order-service';

export interface WorkOrderAcceptanceDependencies {
  readonly database: RuntimeDatabase;
  readonly repository: EntityRepository;
  readonly service: WorkOrderService;
  readonly dashboard: DashboardService;
  readonly dispatcher: ActorDto;
  readonly handler: ActorDto;
  readonly reviewer: ActorDto;
  readonly admin: ActorDto;
  readonly context: (connection: DatabaseSync, actor: ActorDto) => WorkOrderContext;
}

export interface WorkOrderAcceptanceResult {
  readonly finalStatus: 'closed';
  readonly finalVersion: number;
  readonly eventCount: number;
  readonly auditCount: number;
  readonly responseSla: 'pending' | 'met' | 'overdue';
  readonly resolutionSla: 'pending' | 'met' | 'overdue';
  readonly totalMetric: number;
  readonly closedMetric: number;
  readonly overdueMetric: number;
}

export function runWorkOrderAcceptanceScenario(
  dependencies: WorkOrderAcceptanceDependencies
): WorkOrderAcceptanceResult {
  const {
    database, repository, service, dashboard, dispatcher, handler, reviewer, admin
  } = dependencies;
  repository.create('service_catalog', {
    code: 'ACC-SVC-001', name: '验收服务', description: '验收工单闭环', active: true
  }, admin);
  database.transaction((connection) => service.createSlaPolicy({
    code: 'ACC-SLA-001', name: '验收SLA', serviceCode: 'ACC-SVC-001',
    priority: 'normal', responseMinutes: 60, resolutionMinutes: 480, active: true
  }, dependencies.context(connection, admin)));
  const created = database.transaction((connection) => service.create({
    title: '验收工单', description: '执行完整工单处理与复核闭环',
    serviceCode: 'ACC-SVC-001', priority: 'normal'
  }, dependencies.context(connection, dispatcher)));
  const dispatched = database.transaction((connection) => service.dispatch({
    workOrderId: created.workOrderId, expectedVersion: created.version,
    handlerId: handler.username, reason: '验收派单'
  }, dependencies.context(connection, dispatcher)));
  const accepted = database.transaction((connection) => service.accept({
    workOrderId: created.workOrderId, expectedVersion: dispatched.version
  }, dependencies.context(connection, handler)));
  const firstRecord = database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: accepted.version, content: '第一轮处理'
  }, dependencies.context(connection, handler)));
  const firstSubmit = database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId, expectedVersion: firstRecord.version,
    resolution: '第一轮解决说明'
  }, dependencies.context(connection, handler)));
  const rejected = database.transaction((connection) => service.rejectReview({
    workOrderId: created.workOrderId, expectedVersion: firstSubmit.version,
    reason: '补充验证记录'
  }, dependencies.context(connection, reviewer)));
  const secondRecord = database.transaction((connection) => service.addProcessingRecord({
    workOrderId: created.workOrderId, expectedVersion: rejected.version, content: '补充验证完成'
  }, dependencies.context(connection, handler)));
  const secondSubmit = database.transaction((connection) => service.submitResolution({
    workOrderId: created.workOrderId, expectedVersion: secondRecord.version,
    resolution: '最终解决说明'
  }, dependencies.context(connection, handler)));
  const closed = database.transaction((connection) => service.approveClose({
    workOrderId: created.workOrderId, expectedVersion: secondSubmit.version,
    comment: '复核通过'
  }, dependencies.context(connection, reviewer)));
  const sla = service.readSlaStatus(
    created.workOrderId,
    dependencies.context(database as unknown as DatabaseSync, dispatcher)
  );
  const dynamicDashboard = service.readDashboardSummary(
    dependencies.context(database as unknown as DatabaseSync, dispatcher)
  );
  const metrics = new Map(
    dashboard.read(dispatcher).map((metric) => [metric.id, metric.value] as const)
  );
  const eventCount = database.prepare(
    'SELECT COUNT(*) AS count FROM biz_work_order_event WHERE work_order_code = ?'
  ).get(created.workOrderCode) as { count: number };
  const auditCount = database.prepare(
    'SELECT COUNT(*) AS count FROM sys_audit_event'
  ).get() as { count: number };
  return Object.freeze({
    finalStatus: 'closed',
    finalVersion: closed.version,
    eventCount: Number(eventCount.count),
    auditCount: Number(auditCount.count),
    responseSla: sla.response,
    resolutionSla: sla.resolution,
    totalMetric: metrics.get('work_order_total') ?? 0,
    closedMetric: metrics.get('work_order_closed') ?? 0,
    overdueMetric: dynamicDashboard.overdue
  });
}

export const workOrderAcceptanceDescriptor = Object.freeze({
  id: 'work_order_service',
  version: '1.0.0',
  scenarios: Object.freeze(['work_order.lifecycle.acceptance'])
});
