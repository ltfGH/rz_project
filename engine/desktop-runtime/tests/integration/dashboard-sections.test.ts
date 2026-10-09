import assert from 'node:assert/strict';
import test from 'node:test';

import { DashboardService } from '../../src/core/dashboard-service';
import type { ActivatedPluginHost, PluginContribution } from '../../src/core/plugin-host';
import { PermissionService } from '../../src/core/permission-service';
import type { RuntimeBlueprint } from '../../src/shared/blueprint';
import { adminActor, createTestRuntime } from '../helpers/runtime-fixture';

function contribution(id: string, value: unknown): PluginContribution {
  return Object.freeze({ pluginId: 'dashboard_test', id, value });
}

function pluginHost(): ActivatedPluginHost {
  const empty = Object.freeze({});
  const summary = Object.freeze({
    id: 'dashboard_test.summary',
    permission: 'assets.list',
    parse: (payload: Readonly<Record<string, never>>) => payload,
    execute: () => Object.freeze({ active: 3, overdue: 1 })
  });
  const secondary = Object.freeze({
    id: 'dashboard_test.secondary',
    permission: 'services.list',
    parse: (payload: Readonly<Record<string, never>>) => payload,
    execute: () => Object.freeze({ total: 7 })
  });
  return Object.freeze({
    activationOrder: Object.freeze(['dashboard_test']),
    migrations: empty,
    services: empty,
    ipc: empty,
    acceptanceScenarios: empty,
    domainCommands: empty,
    lifecycleBlockers: empty,
    completionHandlers: empty,
    domainActions: Object.freeze({
      'dashboard_test.summary': contribution('dashboard_test.summary', summary),
      'dashboard_test.secondary': contribution('dashboard_test.secondary', secondary)
    }),
    uiExtensions: Object.freeze({
      'dashboard_test.summary_view': contribution('dashboard_test.summary_view', {
        id: 'dashboard_test.summary_view',
        slot: 'dashboard.sections',
        label: 'Asset overview',
        order: 20,
        viewId: 'asset_overview',
        dataSource: 'dashboard_test.summary',
        presentation: {
          groups: [{
            id: 'attention',
            label: 'Attention',
            kind: 'attention',
            items: [
              { id: 'overdue', sourceKey: 'overdue', label: 'Overdue', tone: 'red', moduleId: 'assets' }
            ]
          }]
        }
      }),
      'dashboard_test.secondary_view': contribution('dashboard_test.secondary_view', {
        id: 'dashboard_test.secondary_view',
        slot: 'dashboard.sections',
        label: 'Service overview',
        order: 10,
        viewId: 'service_overview',
        dataSource: 'dashboard_test.secondary',
        presentation: {
          groups: [{
            id: 'status',
            label: 'Status',
            kind: 'status',
            items: [
              { id: 'total', sourceKey: 'total', label: 'Total', tone: 'teal', moduleId: 'services' }
            ]
          }]
        }
      })
    })
  });
}

test('builds an ordered immutable dashboard snapshot from permitted domain summaries', (t) => {
  const runtime = createTestRuntime(t);
  const blueprint: RuntimeBlueprint = {
    ...runtime.blueprint,
    plugins: [{ id: 'dashboard_test', config: {} }],
    dashboards: [{
      id: 'asset_count', name: 'Assets', entity: 'asset', aggregation: 'count', filters: []
    }]
  };
  const calls: string[] = [];
  const service = new DashboardService(runtime.database, blueprint, runtime.schema, {
    plugins: pluginHost(),
    permissions: new PermissionService(blueprint),
    domain: {
      execute: (id: string) => {
        calls.push(id);
        return id.endsWith('secondary') ? { total: 7 } : { active: 3, overdue: 1 };
      }
    }
  });

  const snapshot = service.read(adminActor);

  assert.equal(snapshot.metrics[0]?.id, 'asset_count');
  assert.deepEqual(snapshot.sections.map((section) => section.id), ['service_overview', 'asset_overview']);
  assert.deepEqual(calls, ['dashboard_test.secondary', 'dashboard_test.summary']);
  assert.equal(snapshot.sections[1]?.groups[0]?.items[0]?.value, 1);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.sections[0]?.groups[0]?.items));
});

test('omits sections the actor cannot read without executing their summaries', (t) => {
  const runtime = createTestRuntime(t);
  const host = pluginHost();
  const calls: string[] = [];
  const denied = { ...adminActor, roleId: 'missing' };
  const service = new DashboardService(runtime.database, runtime.blueprint, runtime.schema, {
    plugins: host,
    permissions: new PermissionService(runtime.blueprint),
    domain: { execute: (id: string) => { calls.push(id); return {}; } }
  });

  assert.deepEqual(service.read(denied).sections, []);
  assert.deepEqual(calls, []);
});

test('propagates a permitted summary failure instead of replacing it with zeroes', (t) => {
  const runtime = createTestRuntime(t);
  const service = new DashboardService(runtime.database, runtime.blueprint, runtime.schema, {
    plugins: pluginHost(),
    permissions: new PermissionService(runtime.blueprint),
    domain: { execute: () => { throw new Error('summary unavailable'); } }
  });

  assert.throws(() => service.read(adminActor), /summary unavailable/);
});
