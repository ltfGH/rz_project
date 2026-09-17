import type {
  WorkOrderPriority,
  WorkOrderStatus
} from '../runtime/types';

export interface WorkOrderSeedOptions {
  readonly seed: number;
  readonly serviceCount: number;
  readonly orderCount: number;
}

interface ServiceSeedRecord {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly active: true;
}

interface SlaSeedRecord {
  readonly code: string;
  readonly name: string;
  readonly service_code: string;
  readonly priority: WorkOrderPriority;
  readonly response_minutes: number;
  readonly resolution_minutes: number;
  readonly active: true;
}

interface WorkOrderSeedRecord {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly service_code: string;
  readonly sla_policy_code: string;
  readonly priority: WorkOrderPriority;
  readonly status: WorkOrderStatus;
  readonly requester_id: string;
  readonly handler_id: string | null;
  readonly resolution: string | null;
  readonly response_due_at: string;
  readonly resolution_due_at: string;
  readonly accepted_at: string | null;
  readonly submitted_at: string | null;
  readonly closed_at: string | null;
}

interface WorkOrderEventSeedRecord {
  readonly code: string;
  readonly work_order_code: string;
  readonly event_type:
    | 'created'
    | 'dispatched'
    | 'accepted'
    | 'processing_recorded'
    | 'resolution_submitted'
    | 'closed';
  readonly from_status: WorkOrderStatus | null;
  readonly to_status: WorkOrderStatus;
  readonly actor_id: string;
  readonly content: string;
  readonly occurred_at: string;
}

export interface WorkOrderSeed {
  readonly records: Readonly<{
    service_catalog: readonly Readonly<ServiceSeedRecord>[];
    sla_policy: readonly Readonly<SlaSeedRecord>[];
    work_order: readonly Readonly<WorkOrderSeedRecord>[];
    work_order_event: readonly Readonly<WorkOrderEventSeedRecord>[];
  }>;
}

const PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent'] as const);
const STATUSES = Object.freeze([
  'pending_dispatch', 'pending_acceptance', 'processing', 'pending_review', 'closed'
] as const);
const SERVICE_NAMES = Object.freeze(['终端支持', '网络支持', '应用支持', '数据支持']);
const ISSUE_NAMES = Object.freeze(['登录异常', '连接异常', '页面异常', '数据异常', '配置异常']);
const LIMITS = Object.freeze({
  low: { response: 240, resolution: 1440 },
  normal: { response: 60, resolution: 480 },
  high: { response: 30, resolution: 240 },
  urgent: { response: 10, resolution: 120 }
});
const BASE_TIME = Date.parse('2025-01-01T00:00:00.000Z');

function assertInteger(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function code(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(4, '0')}`;
}

function slaCode(serviceIndex: number, priority: WorkOrderPriority): string {
  return `SLA-${String(serviceIndex + 1).padStart(4, '0')}-${priority.toUpperCase()}`;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function freezeRecords<T extends object>(records: T[]): readonly Readonly<T>[] {
  return Object.freeze(records.map((record) => Object.freeze(record)));
}

export function generateWorkOrderSeed(options: WorkOrderSeedOptions): WorkOrderSeed {
  assertInteger(options.seed, 'seed', -0x8000_0000, 0xffff_ffff);
  assertInteger(options.serviceCount, 'serviceCount', 1, 50);
  assertInteger(options.orderCount, 'orderCount', 5, 10_000);
  const random = createRandom(options.seed);
  const services: ServiceSeedRecord[] = [];
  const policies: SlaSeedRecord[] = [];
  for (let serviceIndex = 0; serviceIndex < options.serviceCount; serviceIndex += 1) {
    const serviceCode = code('SVC', serviceIndex);
    services.push({
      code: serviceCode,
      name: `${SERVICE_NAMES[serviceIndex % SERVICE_NAMES.length]}-${String(serviceIndex + 1).padStart(2, '0')}`,
      description: '确定性离线服务目录',
      active: true
    });
    for (const priority of PRIORITIES) {
      policies.push({
        code: slaCode(serviceIndex, priority),
        name: `${priority.toUpperCase()} 服务时限`,
        service_code: serviceCode,
        priority,
        response_minutes: LIMITS[priority].response,
        resolution_minutes: LIMITS[priority].resolution,
        active: true
      });
    }
  }

  const orders: WorkOrderSeedRecord[] = [];
  const events: WorkOrderEventSeedRecord[] = [];
  let eventIndex = 0;
  const seedDayOffset = (options.seed >>> 0) % 365;
  const appendEvent = (
    workOrderCode: string,
    eventType: WorkOrderEventSeedRecord['event_type'],
    fromStatus: WorkOrderStatus | null,
    toStatus: WorkOrderStatus,
    actorId: string,
    content: string,
    occurredAt: number
  ) => {
    events.push({
      code: code('WOEVT', eventIndex++),
      work_order_code: workOrderCode,
      event_type: eventType,
      from_status: fromStatus,
      to_status: toStatus,
      actor_id: actorId,
      content,
      occurred_at: iso(occurredAt)
    });
  };

  for (let index = 0; index < options.orderCount; index += 1) {
    const status = STATUSES[index % STATUSES.length]!;
    const statusIndex = STATUSES.indexOf(status);
    const serviceIndex = Math.floor(random() * services.length);
    const priority = PRIORITIES[Math.floor(random() * PRIORITIES.length)]!;
    const limits = LIMITS[priority];
    const createdAt = BASE_TIME + (seedDayOffset * 24 + index * 3) * 60 * 60_000;
    const dispatchedAt = createdAt + 10 * 60_000;
    const acceptedAt = createdAt + 30 * 60_000;
    const processedAt = createdAt + 60 * 60_000;
    const submittedAt = createdAt + 90 * 60_000;
    const closedAt = createdAt + 120 * 60_000;
    const workOrderCode = code('WO', index);
    const handlerId = statusIndex >= 1
      ? `处理岗位-${String(1 + Math.floor(random() * 8)).padStart(2, '0')}`
      : null;
    orders.push({
      code: workOrderCode,
      title: `${ISSUE_NAMES[Math.floor(random() * ISSUE_NAMES.length)]}-${String(index + 1).padStart(3, '0')}`,
      description: '确定性生成的离线工单问题描述',
      service_code: services[serviceIndex]!.code,
      sla_policy_code: slaCode(serviceIndex, priority),
      priority,
      status,
      requester_id: `调度岗位-${String(1 + (index % 4)).padStart(2, '0')}`,
      handler_id: handlerId,
      resolution: statusIndex >= 3 ? '已完成离线处理并验证' : null,
      response_due_at: iso(createdAt + limits.response * 60_000),
      resolution_due_at: iso(createdAt + limits.resolution * 60_000),
      accepted_at: statusIndex >= 2 ? iso(acceptedAt) : null,
      submitted_at: statusIndex >= 3 ? iso(submittedAt) : null,
      closed_at: statusIndex >= 4 ? iso(closedAt) : null
    });
    const requesterId = `调度岗位-${String(1 + (index % 4)).padStart(2, '0')}`;
    appendEvent(
      workOrderCode, 'created', null, 'pending_dispatch', requesterId, '创建工单', createdAt
    );
    if (statusIndex >= 1) appendEvent(
      workOrderCode, 'dispatched', 'pending_dispatch', 'pending_acceptance',
      requesterId, '派发工单', dispatchedAt
    );
    if (statusIndex >= 2) {
      appendEvent(
        workOrderCode, 'accepted', 'pending_acceptance', 'processing',
        handlerId!, '受理工单', acceptedAt
      );
      appendEvent(
        workOrderCode, 'processing_recorded', 'processing', 'processing',
        handlerId!, '记录处理过程', processedAt
      );
    }
    if (statusIndex >= 3) appendEvent(
      workOrderCode, 'resolution_submitted', 'processing', 'pending_review',
      handlerId!, '提交解决说明', submittedAt
    );
    if (statusIndex >= 4) appendEvent(
      workOrderCode, 'closed', 'pending_review', 'closed',
      `复核岗位-${String(1 + (index % 3)).padStart(2, '0')}`, '复核关闭', closedAt
    );
  }

  return Object.freeze({
    records: Object.freeze({
      service_catalog: freezeRecords(services),
      sla_policy: freezeRecords(policies),
      work_order: freezeRecords(orders),
      work_order_event: freezeRecords(events)
    })
  });
}

export const workOrderSeedDescriptor = Object.freeze({
  id: 'work_order_service',
  version: '1.0.0'
});
