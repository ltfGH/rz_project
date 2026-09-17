import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import {
  WorkOrderService,
  workOrderRuntimeDescriptor
} from '../../packs/work_order_service/runtime/index';
import { runWorkOrderAcceptanceScenario } from '../../packs/work_order_service/tests/index';
import { AuditService } from '../../../desktop-runtime/src/core/audit-service';
import { loadRuntimeBlueprint } from '../../../desktop-runtime/src/core/blueprint-loader';
import { openDatabase } from '../../../desktop-runtime/src/core/database';
import { DashboardService } from '../../../desktop-runtime/src/core/dashboard-service';
import { EntityRepository } from '../../../desktop-runtime/src/core/entity-repository';
import { PermissionService } from '../../../desktop-runtime/src/core/permission-service';
import { PluginRegistry } from '../../../desktop-runtime/src/core/plugin-registry';
import { compileSchema } from '../../../desktop-runtime/src/core/schema-compiler';
import type { RuntimeBlueprint } from '../../../desktop-runtime/src/shared/blueprint';
import type { ActorDto } from '../../../desktop-runtime/src/shared/dto';
import { AppError } from '../../../desktop-runtime/src/shared/errors';

const dispatcher: ActorDto = {
  userId: 1, username: 'dispatcher-01', displayName: '调度岗位-01', roleId: 'work_order_dispatcher'
};
const handler: ActorDto = {
  userId: 2, username: 'handler-01', displayName: '处理岗位-01', roleId: 'work_order_handler'
};
const reviewer: ActorDto = {
  userId: 3, username: 'reviewer-01', displayName: '复核岗位-01', roleId: 'work_order_reviewer'
};
const admin: ActorDto = {
  userId: 4, username: 'work-admin-01', displayName: '配置岗位-01', roleId: 'work_order_admin'
};

test('loads, activates and runs the production work order pack against real SQLite', (t) => {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'work_order_service'));
  const packRegistry = new PackRegistry();
  packRegistry.register(pack);
  const composed = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: {
      id: 'work_order_acceptance', name: '工单验收软件', version: '1.0.0',
      purpose: '验收工单闭环', targetUsers: ['业务岗位'], boundaries: ['离线'], loginMode: 'required'
    },
    selections: [{ id: 'work_order_service', version: '1.0.0', config: {} }],
    coverage: { supported: ['工单闭环'], unsupported: [] },
    materials: {
      developmentPurpose: '验收工单闭环', industry: '企业服务', technicalFeatures: ['SQLite事务']
    }
  }, packRegistry);
  assert.equal(composed.canGenerate, true, composed.summary);
  const source = JSON.stringify(composed.blueprint);
  const digest = createHash('sha256').update(source, 'utf8').digest('hex');
  const plugins = new PluginRegistry();
  plugins.register(workOrderRuntimeDescriptor);
  const blueprint = loadRuntimeBlueprint(source, digest, plugins) as RuntimeBlueprint;

  const contributions: Record<string, string[]> = {};
  const sink = (kind: string) => ({
    register: (pluginId: string, contributionId: string) => {
      (contributions[kind] ??= []).push(`${pluginId}:${contributionId}`);
    }
  });
  plugins.activate(blueprint.plugins, {
    migrations: sink('migrations'), services: sink('services'), ipc: sink('ipc'),
    uiExtensions: sink('ui'), acceptanceScenarios: sink('acceptance')
  });
  assert.deepEqual(contributions, {
    migrations: ['work_order_service:work_order_service.v1'],
    services: ['work_order_service:work_order.lifecycle'],
    ipc: [
      'work_order_service:sla_policy.create',
      'work_order_service:sla_policy.update',
      'work_order_service:work_order.create',
      'work_order_service:work_order.dispatch',
      'work_order_service:work_order.accept',
      'work_order_service:work_order.add_processing_record',
      'work_order_service:work_order.submit_resolution',
      'work_order_service:work_order.reject_review',
      'work_order_service:work_order.approve_close',
      'work_order_service:work_order.sla_status',
      'work_order_service:work_order.dashboard_summary'
    ],
    ui: [
      'work_order_service:work_order.processing.tab',
      'work_order_service:work_order.history.tab',
      'work_order_service:work_order.sla.tab',
      'work_order_service:work_order.lifecycle.actions',
      'work_order_service:work_order.sla.dashboard',
      'work_order_service:sla_policy.manage.actions'
    ],
    acceptance: ['work_order_service:work_order.lifecycle.acceptance']
  });

  const unsupported = JSON.parse(source) as RuntimeBlueprint;
  (unsupported.plugins[0] as { config: Record<string, unknown> }).config = { unknown: true };
  const unsupportedSource = JSON.stringify(unsupported);
  assert.throws(() => loadRuntimeBlueprint(
    unsupportedSource,
    createHash('sha256').update(unsupportedSource, 'utf8').digest('hex'),
    plugins
  ), (error) => error instanceof AppError && error.code === 'BLUEPRINT_INCOMPATIBLE');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-order-acceptance-'));
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const repository = new EntityRepository(database, blueprint, schema);
  const permissions = new PermissionService(blueprint);
  const audit = new AuditService('1.0.0', () => new Date('2026-09-17T08:00:00.000Z'));
  const dashboard = new DashboardService(database, blueprint, schema);
  let orderSequence = 0;
  let eventSequence = 0;
  const result = runWorkOrderAcceptanceScenario({
    database, repository, service: new WorkOrderService(), dashboard,
    dispatcher, handler, reviewer, admin,
    context: (connection, actor) => ({
      connection,
      actor,
      requirePermission: (currentActor, permission) => permissions.require(currentActor, permission),
      appendAudit: (currentConnection, entry) => audit.append(currentConnection, entry),
      identityHasRole: (identityId, roleId) => (
        (identityId === dispatcher.username && roleId === dispatcher.roleId) ||
        (identityId === handler.username && roleId === handler.roleId) ||
        (identityId === reviewer.username && roleId === reviewer.roleId) ||
        (identityId === admin.username && roleId === admin.roleId)
      ),
      now: () => new Date('2026-09-17T08:00:00.000Z'),
      orderCode: () => `WO-ACC-${++orderSequence}`,
      eventCode: () => `WOEVT-ACC-${++eventSequence}`
    })
  });
  assert.deepEqual(result, {
    finalStatus: 'closed', finalVersion: 9, eventCount: 9, auditCount: 10,
    responseSla: 'met', resolutionSla: 'met', totalMetric: 1, closedMetric: 1,
    overdueMetric: 0
  });
});
