import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import { AssetLifecycleService } from '../../packs/asset_registry/runtime/index';
import { runAssetAcceptanceScenario } from '../../packs/asset_registry/tests/index';
import { AuditService } from '../../../desktop-runtime/src/core/audit-service';
import { openDatabase } from '../../../desktop-runtime/src/core/database';
import { DashboardService } from '../../../desktop-runtime/src/core/dashboard-service';
import { EntityRepository } from '../../../desktop-runtime/src/core/entity-repository';
import { PermissionService } from '../../../desktop-runtime/src/core/permission-service';
import { compileSchema } from '../../../desktop-runtime/src/core/schema-compiler';
import type { RuntimeBlueprint } from '../../../desktop-runtime/src/shared/blueprint';
import type { ActorDto } from '../../../desktop-runtime/src/shared/dto';

const actor: ActorDto = {
  userId: 1, username: 'asset_admin', displayName: '资产管理员', roleId: 'asset_admin'
};

test('runs the production asset pack workflow against real SQLite', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-acceptance-'));
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'asset_registry'));
  const registry = new PackRegistry();
  registry.register(pack);
  const composed = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: {
      id: 'asset_acceptance', name: '资产验收软件', version: '1.0.0', purpose: '资产闭环验收',
      targetUsers: ['资产管理员'], boundaries: ['离线'], loginMode: 'required'
    },
    selections: [{ id: 'asset_registry', version: '1.0.0', config: {} }],
    coverage: { supported: ['资产台账'], unsupported: [] },
    materials: { developmentPurpose: '资产闭环验收', industry: '企业管理', technicalFeatures: ['离线'] }
  }, registry);
  assert.equal(composed.canGenerate, true, composed.summary);
  const blueprint = composed.blueprint as unknown as RuntimeBlueprint;
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
  let eventSequence = 0;
  const result = runAssetAcceptanceScenario({
    database,
    repository,
    lifecycle: new AssetLifecycleService(),
    dashboard,
    actor,
    context: (connection) => ({
      connection,
      actor,
      requirePermission: (currentActor, permission) => permissions.require(currentActor, permission),
      appendAudit: (currentConnection, entry) => audit.append(currentConnection, entry),
      blockers: [],
      now: () => new Date('2026-09-17T08:00:00.000Z'),
      eventCode: () => `AEVT-ACC-${++eventSequence}`
    })
  });

  assert.deepEqual(result.metrics, { total: 2, active: 1, maintenance: 1 });
  assert.equal(result.responsibilityCount, 1);
  assert.equal(result.eventCount, 2);
  assert.equal(result.auditCount, 2);
  assert.equal(result.assetVersion, 3);
});
