import assert from 'node:assert/strict';
import test from 'node:test';

import { PluginHost } from '../../src/core/plugin-host';
import {
  PluginRegistry,
  type PluginContributionSink,
  type PluginDescriptor
} from '../../src/core/plugin-registry';

function descriptor(id: string, calls: string[]): PluginDescriptor {
  const register = (sink: PluginContributionSink, suffix: string): void => {
    sink.register(id, `${id}.${suffix}`, Object.freeze({ owner: id, suffix }));
  };
  return Object.freeze({
    id,
    version: '1.0.0',
    blueprintSchemaVersions: Object.freeze(['1.0']),
    validateConfig: () => calls.push(`${id}:validate`),
    registerMigrations: (sink) => register(sink, 'migration'),
    registerServices: (sink) => register(sink, 'service'),
    registerIpc: (sink) => register(sink, 'ipc'),
    registerUiExtensions: (sink) => register(sink, 'ui'),
    registerAcceptanceScenarios: (sink) => register(sink, 'acceptance'),
    registerDomainActions: (sink) => register(sink, 'action'),
    registerDomainCommands: (sink) => register(sink, 'command'),
    registerLifecycleBlockers: (sink) => register(sink, 'blocker'),
    registerCompletionHandlers: (sink) => register(sink, 'completion')
  });
}

test('activates selections in locked dependency order and freezes every registry', () => {
  const calls: string[] = [];
  const registry = new PluginRegistry();
  registry.register(descriptor('bridge', calls));
  registry.register(descriptor('core', calls));
  const host = new PluginHost();

  registry.activate(
    [{ id: 'bridge', config: {} }, { id: 'core', config: {} }],
    host,
    ['core', 'bridge']
  );
  const activated = host.freeze();

  assert.deepEqual(activated.activationOrder, ['core', 'bridge']);
  assert.deepEqual(Object.keys(activated.services), ['core.service', 'bridge.service']);
  assert.deepEqual(Object.keys(activated.domainActions), ['core.action', 'bridge.action']);
  assert.deepEqual(Object.keys(activated.domainCommands), ['core.command', 'bridge.command']);
  assert.throws(
    () => host.services.register('late', 'late.service', {}),
    /frozen/i
  );
});

test('rejects duplicate contribution ids across plugins', () => {
  const host = new PluginHost();
  host.services.register('first', 'shared.service', {});
  assert.throws(
    () => host.services.register('second', 'shared.service', {}),
    /already registered/i
  );
});

test('rejects locked versions and dependency orders that do not match registered plugins', () => {
  const registry = new PluginRegistry();
  registry.register(descriptor('core', []));

  assert.throws(() => registry.assertLocked({
    dependencyOrder: ['core'],
    packs: [{ id: 'core', version: '2.0.0' }]
  }), /version/i);
  assert.throws(() => registry.assertLocked({
    dependencyOrder: ['missing'],
    packs: [{ id: 'missing', version: '1.0.0' }]
  }), /not registered/i);
  assert.throws(() => registry.assertLocked({
    dependencyOrder: ['core', 'core'],
    packs: [{ id: 'core', version: '1.0.0' }]
  }), /duplicate/i);
});

test('rejects an activation order that omits or adds selected plugins', () => {
  const registry = new PluginRegistry();
  registry.register(descriptor('core', []));
  registry.register(descriptor('bridge', []));

  assert.throws(
    () => registry.activate(
      [{ id: 'core', config: {} }, { id: 'bridge', config: {} }],
      new PluginHost(),
      ['core']
    ),
    /activation order/i
  );
});
