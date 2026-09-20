import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalProjectLock,
  compareProjectLocks,
  createProjectLock,
  verifyProjectResources,
  type ProjectLock
} from '../../src/core/project-lock';
import { AppError } from '../../src/shared/errors';

const domainLock = Object.freeze({
  lockVersion: '1.0', blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
  dependencyOrder: Object.freeze(['asset_registry']),
  packs: Object.freeze([{ id: 'asset_registry', version: '1.0.0' }])
});

function input(projectConfig: Readonly<Record<string, unknown>> = { name: 'test', options: { a: 1, b: 2 } }) {
  return {
    generatorVersion: '1.0.0', blueprintSchemaVersion: '1.0' as const, domainLock,
    databaseSchemaVersion: 1, desktopRuntimeVersion: '1.0.0', electronVersion: '44.4.1',
    nodeVersion: '22.21.0', sqliteVersion: '3.50.4', projectConfig,
    buildTarget: 'win-nsis-x64' as const
  };
}

test('creates byte-stable locks from equivalent normalized project input', () => {
  const first = createProjectLock(input({ name: 'test', options: { a: 1, b: 2 } }));
  const reordered = createProjectLock(input({ options: { b: 2, a: 1 }, name: 'test' }));
  assert.equal(canonicalProjectLock(first), canonicalProjectLock(reordered));
  assert.deepEqual(first.packs, [{ id: 'asset_registry', version: '1.0.0' }]);
  assert.equal(first.domainLockSha256.length, 64);
  assert.equal(first.projectConfigSha256.length, 64);
});

test('reports pack and runtime changes and requires migration evidence', () => {
  const previous = createProjectLock(input());
  const next = {
    ...previous,
    packs: Object.freeze([{ id: 'asset_registry', version: '1.1.0' }]),
    databaseSchemaVersion: 2,
    runtime: Object.freeze({ ...previous.runtime, electron: '45.0.0' })
  } satisfies ProjectLock;
  const report = compareProjectLocks(previous, next);
  assert.deepEqual(report.changedPacks, [{ id: 'asset_registry', from: '1.0.0', to: '1.1.0' }]);
  assert.deepEqual(report.requiredChecks, ['migration', 'asset_registry', 'combinations', 'desktop-runtime']);
  assert.equal(report.runtimeChanged, true);
  assert.equal(report.allowed, false);
});

test('verifies every locked resource and rejects one-byte tampering', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-resources-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const domainText = JSON.stringify(domainLock);
  const lock = createProjectLock(input());
  const resources: Record<string, string> = {
    'blueprint.json': '{"schemaVersion":"1.0","plugins":[],"software":{"id":"test"}}',
    'seed.json': '{"users":[],"records":{}}',
    'domain-lock.json': domainText,
    'project.lock.json': canonicalProjectLock(lock),
    'production-runtime-catalog.cjs': 'module.exports={productionPluginDescriptors:Object.freeze([])};'
  };
  for (const [name, content] of Object.entries(resources)) {
    fs.writeFileSync(path.join(directory, name), content, 'utf8');
  }
  const files = Object.fromEntries(Object.entries(resources).map(([name, content]) => [
    name, createHash('sha256').update(content).digest('hex')
  ]));
  fs.writeFileSync(path.join(directory, 'resource-manifest.json'), JSON.stringify({
    manifestVersion: '1.0', files
  }), 'utf8');

  const verified = verifyProjectResources(directory);
  assert.equal(verified.projectLock.domainLockSha256, lock.domainLockSha256);
  assert.equal(verified.blueprintSha256, files['blueprint.json']);

  for (const [name, content] of Object.entries(resources)) {
    fs.appendFileSync(path.join(directory, name), 'x', 'utf8');
    assert.throws(() => verifyProjectResources(directory), new RegExp(name.replace('.', '\\.')));
    fs.writeFileSync(path.join(directory, name), content, 'utf8');
  }
});

test('rejects a project lock whose domain digest or pack order disagrees with domain lock', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-lock-mismatch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wrong = { ...createProjectLock(input()), domainLockSha256: '0'.repeat(64) };
  const resources = {
    'blueprint.json': '{}', 'seed.json': '{}', 'domain-lock.json': JSON.stringify(domainLock),
    'project.lock.json': canonicalProjectLock(wrong as ProjectLock),
    'production-runtime-catalog.cjs': 'module.exports={productionPluginDescriptors:[]};'
  };
  for (const [name, content] of Object.entries(resources)) fs.writeFileSync(path.join(directory, name), content);
  fs.writeFileSync(path.join(directory, 'resource-manifest.json'), JSON.stringify({
    manifestVersion: '1.0',
    files: Object.fromEntries(Object.entries(resources).map(([name, content]) => [name, createHash('sha256').update(content).digest('hex')]))
  }));
  assert.throws(() => verifyProjectResources(directory), /domain lock digest/i);
});

test('reports a missing resource without exposing its absolute directory', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-resource-missing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'resource-manifest.json'), JSON.stringify({
    manifestVersion: '1.0', files: {}
  }));
  assert.throws(
    () => verifyProjectResources(directory),
    (error: unknown) => error instanceof AppError &&
      error.code === 'BLUEPRINT_INCOMPATIBLE' &&
      /blueprint\.json/.test(error.message) &&
      !error.message.includes(directory)
  );
});
