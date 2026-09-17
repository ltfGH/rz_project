import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const cli = path.join(root, 'src', 'cli.ts');
const assetPack = path.join(root, 'tests', 'fixtures', 'packs', 'asset-provider');

function envelope(unsupported: string[] = []) {
  return {
    packs: [assetPack],
    composition: {
      blueprintSchemaVersion: '1.0',
      runtimeVersion: '1.0.0',
      software: {
        id: 'asset_app', name: '资产管理软件', version: '1.0.0', purpose: '管理资产',
        targetUsers: ['资产管理员'], boundaries: ['离线运行'], loginMode: 'required'
      },
      selections: [{ id: 'asset_registry', version: '1.0.0', config: {} }],
      coverage: { supported: ['资产台账'], unsupported },
      materials: {
        developmentPurpose: '形成资产台账', industry: '企业管理', technicalFeatures: ['离线运行']
      }
    }
  };
}

function run(requestPath: string, outputPath: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, '--request', requestPath, '--output', outputPath], {
    cwd: root, encoding: 'utf8', windowsHide: true
  });
}

function temp(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-compose-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function copyDirectory(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

test('writes three canonical outputs atomically for a valid request', (t) => {
  const directory = temp(t);
  const requestPath = path.join(directory, 'request.json');
  const outputPath = path.join(directory, 'output');
  fs.writeFileSync(requestPath, JSON.stringify(envelope()), 'utf8');

  const result = run(requestPath, outputPath);

  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.canGenerate, true);
  assert.equal(response.outputPath, outputPath);
  assert.deepEqual(fs.readdirSync(outputPath).sort(), [
    'blueprint.json', 'composition-report.json', 'domain-lock.json'
  ]);
  for (const name of fs.readdirSync(outputPath)) {
    assert.equal(fs.readFileSync(path.join(outputPath, name), 'utf8').endsWith('\n'), true);
  }
});

test('returns exit one and writes no output for blocked composition', (t) => {
  const directory = temp(t);
  const requestPath = path.join(directory, 'request.json');
  const outputPath = path.join(directory, 'blocked-output');
  fs.writeFileSync(requestPath, JSON.stringify(envelope(['自动控制设备'])), 'utf8');

  const result = run(requestPath, outputPath);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).canGenerate, false);
  assert.equal(fs.existsSync(outputPath), false);
});

test('rejects malformed, relative, oversized and nonempty paths without leaking input', (t) => {
  const directory = temp(t);
  const malformed = path.join(directory, 'malformed.json');
  const secret = 'must-not-appear-in-errors';
  fs.writeFileSync(malformed, `{ "secret": "${secret}"`, 'utf8');
  const malformedResult = run(malformed, path.join(directory, 'malformed-output'));
  assert.equal(malformedResult.status, 2);
  assert.doesNotMatch(malformedResult.stderr, new RegExp(secret));

  const relative = run('request.json', path.join(directory, 'relative-output'));
  assert.equal(relative.status, 2);
  assert.match(relative.stderr, /absolute/i);

  const oversized = path.join(directory, 'oversized.json');
  fs.writeFileSync(oversized, Buffer.alloc((5 * 1024 * 1024) + 1, 0x20));
  assert.equal(run(oversized, path.join(directory, 'oversized-output')).status, 2);

  const valid = path.join(directory, 'valid.json');
  fs.writeFileSync(valid, JSON.stringify(envelope()), 'utf8');
  const nonempty = path.join(directory, 'nonempty');
  fs.mkdirSync(nonempty); fs.writeFileSync(path.join(nonempty, 'keep.txt'), 'keep');
  assert.equal(run(valid, nonempty).status, 2);
  assert.equal(fs.readFileSync(path.join(nonempty, 'keep.txt'), 'utf8'), 'keep');
});

test('removes staging and leaves target absent when composition fails', (t) => {
  const directory = temp(t);
  const requestPath = path.join(directory, 'request.json');
  const outputPath = path.join(directory, 'output');
  const value = envelope();
  value.composition.selections[0]!.id = 'missing_pack';
  fs.writeFileSync(requestPath, JSON.stringify(value), 'utf8');

  const result = run(requestPath, outputPath);

  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(outputPath), false);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['request.json']);
});

test('bundled CLI composes without domain-pack node_modules', (t) => {
  const directory = temp(t);
  const isolatedEngine = path.join(directory, 'engine');
  const isolatedBin = path.join(isolatedEngine, 'domain-packs', 'bin');
  fs.mkdirSync(isolatedBin, { recursive: true });
  fs.copyFileSync(path.join(root, 'bin', 'domain-pack-cli.cjs'), path.join(isolatedBin, 'domain-pack-cli.cjs'));
  copyDirectory(path.resolve(root, '..', 'blueprint'), path.join(isolatedEngine, 'blueprint'));
  copyDirectory(path.resolve(root, '..', 'config'), path.join(isolatedEngine, 'config'));
  const requestPath = path.join(directory, 'request.json');
  const outputPath = path.join(directory, 'output');
  fs.writeFileSync(requestPath, JSON.stringify(envelope()), 'utf8');

  const result = spawnSync(
    process.execPath,
    [path.join(isolatedBin, 'domain-pack-cli.cjs'), '--request', requestPath, '--output', outputPath],
    { cwd: directory, encoding: 'utf8', windowsHide: true }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).canGenerate, true);
});
