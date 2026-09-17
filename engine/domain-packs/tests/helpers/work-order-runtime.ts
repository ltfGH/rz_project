import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type test from 'node:test';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import { openDatabase } from '../../../desktop-runtime/src/core/database';
import { EntityRepository } from '../../../desktop-runtime/src/core/entity-repository';
import { compileSchema } from '../../../desktop-runtime/src/core/schema-compiler';
import type { RuntimeBlueprint } from '../../../desktop-runtime/src/shared/blueprint';
import type { ActorDto } from '../../../desktop-runtime/src/shared/dto';
import type { WorkOrderContext } from '../../packs/work_order_service/runtime/types';

export const dispatcher: ActorDto = {
  userId: 1, username: 'dispatcher-01', displayName: '调度岗位-01', roleId: 'work_order_dispatcher'
};

export const admin: ActorDto = {
  userId: 99, username: 'work-admin-01', displayName: '工单配置岗位-01', roleId: 'work_order_admin'
};

let orderSequence = 0;
let eventSequence = 0;

export function composeWorkOrderBlueprint(): RuntimeBlueprint {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'work_order_service'));
  const registry = new PackRegistry();
  registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: {
      id: 'work_order_test', name: '工单测试软件', version: '1.0.0',
      purpose: '测试工单闭环', targetUsers: ['业务岗位'], boundaries: ['离线'], loginMode: 'required'
    },
    selections: [{ id: 'work_order_service', version: '1.0.0', config: {} }],
    coverage: { supported: ['工单闭环'], unsupported: [] },
    materials: {
      developmentPurpose: '测试工单闭环', industry: '企业服务', technicalFeatures: ['SQLite事务']
    }
  }, registry);
  if (!result.canGenerate || !result.blueprint) throw new Error(result.summary);
  return result.blueprint as unknown as RuntimeBlueprint;
}

export function createWorkOrderTestRuntime(
  t: test.TestContext,
  options: Readonly<{ serviceActive?: boolean; slaCount?: number }> = {}
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-order-runtime-'));
  const blueprint = composeWorkOrderBlueprint();
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  const repository = new EntityRepository(database, blueprint, schema);
  repository.create('service_catalog', {
    code: 'SVC-1', name: '现场支持', description: '现场问题支持',
    active: options.serviceActive ?? true
  }, admin);
  const slaCount = options.slaCount ?? 1;
  for (let index = 0; index < slaCount; index += 1) {
    repository.create('sla_policy', {
      code: `SLA-${index + 1}`, name: `普通策略 ${index + 1}`, service_code: 'SVC-1',
      priority: 'normal', response_minutes: 60, resolution_minutes: 480, active: true
    }, admin);
  }
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, repository, blueprint, schema };
}

export function workOrderContext(
  connection: any,
  actor: ActorDto = dispatcher,
  overrides: Partial<WorkOrderContext> = {}
): WorkOrderContext {
  return {
    connection,
    actor,
    requirePermission: () => undefined,
    appendAudit: () => undefined,
    identityHasRole: (identityId, roleId) => (
      (identityId === 'dispatcher-01' && roleId === 'work_order_dispatcher') ||
      (identityId === 'handler-01' && roleId === 'work_order_handler') ||
      (identityId === 'reviewer-01' && roleId === 'work_order_reviewer')
    ),
    now: () => new Date('2026-09-17T08:00:00.000Z'),
    orderCode: () => `WO-TEST-${++orderSequence}`,
    eventCode: () => `WOEVT-TEST-${++eventSequence}`,
    ...overrides
  };
}
