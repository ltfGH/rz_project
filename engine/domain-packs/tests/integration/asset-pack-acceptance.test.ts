import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';
import {
  AssetLifecycleService,
  assetRuntimeDescriptor
} from '../../packs/asset_registry/runtime/index';
import { runAssetAcceptanceScenario } from '../../packs/asset_registry/tests/index';
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
  const source = JSON.stringify(composed.blueprint);
  const digest = createHash('sha256').update(source, 'utf8').digest('hex');
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register(assetRuntimeDescriptor);
  const blueprint = loadRuntimeBlueprint(source, digest, pluginRegistry) as RuntimeBlueprint;
  const contributions: Record<string, string[]> = {};
  const sink = (kind: string) => ({
    register: (pluginId: string, contributionId: string) => {
      (contributions[kind] ??= []).push(`${pluginId}:${contributionId}`);
    }
  });
  pluginRegistry.activate(blueprint.plugins, {
    migrations: sink('migrations'),
    services: sink('services'),
    ipc: sink('ipc'),
    uiExtensions: sink('ui'),
    acceptanceScenarios: sink('acceptance')
  });
  assert.deepEqual(contributions, {
    migrations: ['asset_registry:asset_registry.v1'],
    services: ['asset_registry:asset.lifecycle'],
    ipc: ['asset_registry:asset.change_status', 'asset_registry:asset.assign_responsibility'],
    ui: [
      'asset_registry:asset.responsibilities.tab',
      'asset_registry:asset.status_history.tab',
      'asset_registry:asset.status.actions'
    ],
    acceptance: ['asset_registry:asset.lifecycle.acceptance']
  });
  const unsupported = JSON.parse(source) as RuntimeBlueprint;
  (unsupported.plugins[0] as { config: Record<string, unknown> }).config = { unknown: true };
  const unsupportedSource = JSON.stringify(unsupported);
  const unsupportedDigest = createHash('sha256').update(unsupportedSource, 'utf8').digest('hex');
  assert.throws(
    () => loadRuntimeBlueprint(unsupportedSource, unsupportedDigest, pluginRegistry),
    (error) => error instanceof AppError && error.code === 'BLUEPRINT_INCOMPATIBLE'
  );
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
