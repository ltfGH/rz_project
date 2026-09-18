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
import type { ProjectContext } from '../../packs/project_task/runtime/types';

export const member: ActorDto = { userId: 31, username: 'project-member-01', displayName: '项目成员-01', roleId: 'project_member' };
export const manager: ActorDto = { userId: 32, username: 'project-manager-01', displayName: '项目经理-01', roleId: 'project_manager' };
export const manager2: ActorDto = { userId: 33, username: 'project-manager-02', displayName: '项目经理-02', roleId: 'project_manager' };
export const reviewer: ActorDto = { userId: 34, username: 'project-reviewer-01', displayName: '项目复核-01', roleId: 'project_reviewer' };
export const admin: ActorDto = { userId: 35, username: 'project-admin-01', displayName: '项目管理-01', roleId: 'project_admin' };

const actors = Object.freeze([member, manager, manager2, reviewer, admin]);
let projectSequence = 0;
let milestoneSequence = 0;
let taskSequence = 0;
let riskSequence = 0;
let deliverableSequence = 0;
let eventSequence = 0;

export function composeProjectBlueprint(): RuntimeBlueprint {
  const registry = new PackRegistry();
  registry.register(loadPack(path.resolve(__dirname, '..', '..', 'packs', 'project_task')));
  const result = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: { id:'project_test', name:'项目测试软件', version:'1.0.0', purpose:'测试项目事务', targetUsers:['项目岗位'], boundaries:['离线'], loginMode:'required' },
    selections: [{ id:'project_task', version:'1.0.0', config:{} }],
    coverage: { supported:['项目任务'], unsupported:[] },
    materials: { developmentPurpose:'测试项目闭环', industry:'企业管理', technicalFeatures:['SQLite事务'] }
  }, registry);
  if (!result.canGenerate || !result.blueprint) throw new Error(result.summary);
  return result.blueprint as unknown as RuntimeBlueprint;
}

export function createProjectRuntime(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-runtime-'));
  const blueprint = composeProjectBlueprint();
  const schema = compileSchema(blueprint);
  const database = openDatabase({ filename: path.join(directory, 'project.sqlite') });
  database.migrate(schema);
  const repository = new EntityRepository(database, blueprint, schema);
  t.after(() => { database.close(); fs.rmSync(directory, { recursive:true, force:true }); });
  return { database, repository, blueprint, schema };
}

export function projectContext(connection: any, actor: ActorDto = admin, overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    connection, actor,
    requirePermission: () => undefined,
    appendAudit: () => undefined,
    identityHasRole: (identityId, roleId) => actors.some((candidate) => candidate.username === identityId && candidate.roleId === roleId),
    closeBlockers: Object.freeze([]),
    now: () => new Date('2026-09-18T08:00:00.000Z'),
    projectCode: () => `PRJ-T-${++projectSequence}`,
    milestoneCode: () => `MS-T-${++milestoneSequence}`,
    taskCode: () => `TASK-T-${++taskSequence}`,
    riskCode: () => `RISK-T-${++riskSequence}`,
    deliverableCode: () => `DEL-T-${++deliverableSequence}`,
    eventCode: () => `PEVT-T-${++eventSequence}`,
    ...overrides
  };
}
