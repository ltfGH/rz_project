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
import type { InspectionContext } from '../../packs/inspection_rectification/runtime/types';

export const planner: ActorDto = {
  userId: 11, username: 'planner-01', displayName: '计划岗位-01', roleId: 'inspection_planner'
};
export const executor: ActorDto = {
  userId: 12, username: 'executor-01', displayName: '执行岗位-01', roleId: 'inspection_executor'
};
export const reviewer: ActorDto = {
  userId: 13, username: 'reviewer-01', displayName: '复核岗位-01', roleId: 'inspection_reviewer'
};
export const admin: ActorDto = {
  userId: 14, username: 'inspection-admin-01', displayName: '巡检管理岗位-01', roleId: 'inspection_admin'
};

let planSequence = 0;
let taskSequence = 0;
let itemSequence = 0;
let eventSequence = 0;

export function composeInspectionBlueprint(): RuntimeBlueprint {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'inspection_rectification'));
  const registry = new PackRegistry();
  registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: {
      id: 'inspection_test', name: '巡检测试软件', version: '1.0.0',
      purpose: '测试巡检闭环', targetUsers: ['巡检岗位'], boundaries: ['离线'], loginMode: 'required'
    },
    selections: [{ id: 'inspection_rectification', version: '1.0.0', config: {} }],
    coverage: { supported: ['巡检闭环'], unsupported: [] },
    materials: {
      developmentPurpose: '测试巡检闭环', industry: '企业运维', technicalFeatures: ['SQLite事务']
    }
  }, registry);
  if (!result.canGenerate || !result.blueprint) throw new Error(result.summary);
  return result.blueprint as unknown as RuntimeBlueprint;
}

export function createInspectionTestRuntime(
  t: test.TestContext,
  options: Readonly<{ seedPlan?: boolean; planActive?: boolean }> = {}
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inspection-runtime-'));
  const blueprint = composeInspectionBlueprint();
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') });
  database.migrate(schema);
  const repository = new EntityRepository(database, blueprint, schema);
  if (options.seedPlan ?? true) {
    database.prepare(
      `INSERT INTO biz_inspection_plan
        (code, name, cycle_days, instructions, active, version, created_at, updated_at)
       VALUES ('PLAN-1', '基础巡检计划', 7, '逐项检查', ?, 1, ?, ?)`
    ).run(
      (options.planActive ?? true) ? 1 : 0,
      '2026-09-18T08:00:00.000Z',
      '2026-09-18T08:00:00.000Z'
    );
  }
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { database, repository, blueprint, schema };
}

export function inspectionContext(
  connection: any,
  actor: ActorDto = planner,
  overrides: Partial<InspectionContext> = {}
): InspectionContext {
  return {
    connection,
    actor,
    requirePermission: () => undefined,
    appendAudit: () => undefined,
    identityHasRole: (identityId, roleId) => (
      (identityId === planner.username && roleId === planner.roleId) ||
      (identityId === executor.username && roleId === executor.roleId) ||
      (identityId === reviewer.username && roleId === reviewer.roleId) ||
      (identityId === admin.username && roleId === admin.roleId)
    ),
    archiveBlockers: [],
    now: () => new Date('2026-09-18T08:00:00.000Z'),
    planCode: () => `IPLAN-TEST-${++planSequence}`,
    taskCode: () => `ITASK-TEST-${++taskSequence}`,
    itemCode: () => `IITEM-TEST-${++itemSequence}`,
    eventCode: () => `IEVT-TEST-${++eventSequence}`,
    ...overrides
  };
}
