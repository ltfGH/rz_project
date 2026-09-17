import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRuntimeBlueprint } from '../../src/core/blueprint-loader';
import { PluginRegistry, type PluginDescriptor } from '../../src/core/plugin-registry';
import { AppError } from '../../src/shared/errors';

const source = '{"schemaVersion":"1.0","plugins":[],"software":{"id":"test_app"}}';
const digest = '94c88aad11d77f449f17ef197ae0aa87f32dc011eee3e9a780f3adbe424f9c2d';

function descriptor(values: Pick<PluginDescriptor, 'id' | 'version' | 'blueprintSchemaVersions'>): PluginDescriptor {
  return {
    ...values,
    validateConfig: () => undefined,
    registerMigrations: () => undefined,
    registerServices: () => undefined,
    registerIpc: () => undefined,
    registerUiExtensions: () => undefined,
    registerAcceptanceScenarios: () => undefined
  };
}

test('loads and freezes an exact supported blueprint resource', () => {
  const result = loadRuntimeBlueprint(source, digest, new PluginRegistry());

  assert.equal(result.schemaVersion, '1.0');
  assert.equal(result.software.id, 'test_app');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.software), true);
});

test('rejects a resource whose bytes do not match the build digest', () => {
  assert.throws(
    () => loadRuntimeBlueprint(`${source}\n`, digest, new PluginRegistry()),
    (error: unknown) => error instanceof AppError && error.code === 'BLUEPRINT_INCOMPATIBLE'
  );
});

test('rejects unsupported blueprint schema versions', () => {
  const changed = source.replace('"1.0"', '"2.0"');
  const changedDigest = '93fae6b4b8ceb896e555172fc4faf704509c3686cffa6aabd396e1bbf0bc7578';

  assert.throws(
    () => loadRuntimeBlueprint(changed, changedDigest, new PluginRegistry()),
    (error: unknown) => error instanceof AppError && error.code === 'BLUEPRINT_INCOMPATIBLE'
  );
});

test('rejects unknown and schema-incompatible plugins', () => {
  const unknownSource = '{"schemaVersion":"1.0","plugins":[{"id":"missing","config":{}}],"software":{"id":"test_app"}}';
  const unknownDigest = '6078c4c504af101a82307b084f736a9d51ed419fa091512082c9934f8e6539ba';
  assert.throws(
    () => loadRuntimeBlueprint(unknownSource, unknownDigest, new PluginRegistry()),
    /Plugin 'missing' is not registered/
  );

  const registry = new PluginRegistry();
  registry.register(descriptor({ id: 'known_plugin', version: '1.0.0', blueprintSchemaVersions: ['2.0'] }));
  const incompatibleSource = '{"schemaVersion":"1.0","plugins":[{"id":"known_plugin","config":{}}],"software":{"id":"test_app"}}';
  const incompatibleDigest = 'f5b31876f9dddfec5035ede8daa4d78664b164f02aba58921af40a82dc73ccd9';
  assert.throws(
    () => loadRuntimeBlueprint(incompatibleSource, incompatibleDigest, registry),
    /does not support blueprint schema '1.0'/
  );
});

test('rejects plugin descriptors missing fixed validation or registration hooks', () => {
  const registry = new PluginRegistry();
  assert.throws(
    () => registry.register({
      id: 'incomplete_plugin', version: '1.0.0', blueprintSchemaVersions: ['1.0']
    } as PluginDescriptor),
    /missing required hook/
  );
});

test('rejects executable-looking keys at any depth', () => {
  const unsafe = '{"schemaVersion":"1.0","plugins":[],"software":{"id":"test_app"},"nested":{"script":"return true"}}';
  const unsafeDigest = '7f3c5864b2c8de40de272b8a0e906b73edf0775fc66f63c487fc0ba12a1ba39e';

  assert.throws(
    () => loadRuntimeBlueprint(unsafe, unsafeDigest, new PluginRegistry()),
    /executable key 'script'/
  );
});

test('does not expose mutable input objects', () => {
  const result = loadRuntimeBlueprint(source, digest, new PluginRegistry());

  assert.equal(Reflect.set(result.software, 'id', 'changed'), false);
  assert.equal(result.software.id, 'test_app');
});
