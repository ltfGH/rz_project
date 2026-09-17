import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';

const fixture = path.resolve(__dirname, '..', 'fixtures', 'packs', 'asset-provider');

function copyDirectory(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function temporaryPack(t: test.TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-pack-'));
  copyDirectory(fixture, directory);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('loads, freezes and hashes a complete regular pack', () => {
  const pack = loadPack(fixture);

  assert.equal(pack.catalog.id, 'asset_registry');
  assert.equal(pack.fragment.pack.id, 'asset_registry');
  assert.match(pack.digest, /^[0-9a-f]{64}$/);
  assert.match(pack.fragmentDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(pack), true);
  assert.equal(Object.isFrozen(pack.catalog), true);
});

test('requires an absolute regular pack root and required files', (t) => {
  assert.throws(() => loadPack('relative/pack'), /absolute/i);

  const missing = temporaryPack(t);
  fs.rmSync(path.join(missing, 'blueprint.json'));
  assert.throws(() => loadPack(missing), /blueprint\.json/);

  const directoryFile = temporaryPack(t);
  fs.rmSync(path.join(directoryFile, 'runtime', 'index.js'));
  fs.mkdirSync(path.join(directoryFile, 'runtime', 'index.js'));
  assert.throws(() => loadPack(directoryFile), /regular file/i);
});

test('rejects entrypoint path escapes before reading outside files', (t) => {
  const root = temporaryPack(t);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
  catalog.entrypoints.runtime = '../outside.js';
  fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify(catalog), 'utf8');

  assert.throws(() => loadPack(root), /entrypoint|catalog/i);
});

test('rejects catalog and fragment identity mismatches', (t) => {
  const root = temporaryPack(t);
  const fragment = JSON.parse(fs.readFileSync(path.join(root, 'blueprint.json'), 'utf8'));
  fragment.pack.version = '2.0.0';
  fs.writeFileSync(path.join(root, 'blueprint.json'), JSON.stringify(fragment), 'utf8');

  assert.throws(() => loadPack(root), /does not match catalog/i);
});

test('rejects reparse-point pack roots', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-pack-link-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const link = path.join(parent, 'linked-pack');
  fs.symlinkSync(fixture, link, 'junction');

  assert.throws(() => loadPack(link), /reparse|symbolic/i);
});

test('registers explicit exact versions and rejects duplicate keys', () => {
  const pack = loadPack(fixture);
  const registry = new PackRegistry();
  registry.register(pack);

  assert.equal(registry.get('asset_registry', '1.0.0'), pack);
  assert.throws(() => registry.get('asset_registry', '2.0.0'), /not registered/i);
  assert.throws(() => registry.register(pack), /already registered/i);
  assert.equal('scan' in registry, false);
  assert.equal('discover' in registry, false);
});
