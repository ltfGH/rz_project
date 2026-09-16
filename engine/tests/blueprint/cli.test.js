'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engineRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(engineRoot, 'blueprint', 'cli.cjs');
const fixtureRoot = path.join(engineRoot, 'tests', 'fixtures', 'blueprints');

function run(args) {
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd: engineRoot,
    encoding: 'utf8',
    windowsHide: true
  });
}

test('returns exit zero and JSON for a blueprint that can generate', () => {
  const result = run(['--input', path.join(fixtureRoot, 'enterprise-ops.valid.json')]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.valid, true);
  assert.equal(output.canGenerate, true);
});

test('returns exit one and JSON for an inspectable blocked blueprint', () => {
  const result = run(['--input', path.join(fixtureRoot, 'unsupported.invalid.json')]);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.valid, true);
  assert.equal(output.canGenerate, false);
  assert.equal(output.issues[0].code, 'UNSUPPORTED_REQUIREMENT');
});

test('returns exit two for malformed JSON without echoing file contents', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'malformed.json');
  const secret = 'must-not-appear-in-cli-errors';
  fs.writeFileSync(inputPath, `{ "secret": "${secret}"`, 'utf8');

  const result = run(['--input', inputPath]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /valid JSON/);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});

test('returns exit two for missing, relative, or extra arguments', () => {
  const missing = run(['--input', path.join(fixtureRoot, 'missing.json')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /regular file/);

  const relative = run(['--input', 'tests/fixtures/blueprints/enterprise-ops.valid.json']);
  assert.equal(relative.status, 2);
  assert.match(relative.stderr, /absolute/);

  const extra = run([
    '--input',
    path.join(fixtureRoot, 'enterprise-ops.valid.json'),
    '--extra'
  ]);
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /Usage/);
});

test('rejects blueprint files larger than five MiB before parsing', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprint-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, 'oversized.json');
  fs.writeFileSync(inputPath, Buffer.alloc((5 * 1024 * 1024) + 1, 0x20));

  const result = run(['--input', inputPath]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /5 MiB/);
});
