'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--unpacked' || !path.isAbsolute(args[1])) {
  fail('Usage: node verify-package.cjs --unpacked <absolute-directory>');
}
const unpacked = path.resolve(args[1]);
const resources = path.join(unpacked, 'resources');
const runtimeResources = path.join(resources, 'runtime-resources');
const blueprint = JSON.parse(fs.readFileSync(path.join(runtimeResources, 'blueprint.json'), 'utf8'));
const executable = path.join(unpacked, `${blueprint.software.name}.exe`);
for (const required of [
  executable,
  path.join(resources, 'app.asar'),
  ...['blueprint.json', 'seed.json', 'domain-lock.json', 'project.lock.json',
    'production-runtime-catalog.cjs', 'resource-manifest.json'].map((name) => path.join(runtimeResources, name))
]) {
  if (!fs.existsSync(required) || !fs.statSync(required).isFile()) fail(`Missing packaged file: ${required}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(runtimeResources, 'resource-manifest.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(runtimeResources, name))).digest('hex');
  if (actual !== expected) fail(`Packaged resource digest mismatch: ${name}`);
}

const forbiddenNames = /(?:\.sqlite(?:3)?|\.db|\.log|reference-closed\.png)$/i;
const forbiddenContent = /(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Dispatch123!|Operator123!|Review123!)/;
const fixtureAccounts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'reference', 'asset-operations', 'accounts.json'), 'utf8'));
const forbiddenDigests = Object.values(fixtureAccounts).map((account) => account.passwordDigest);
const pending = [unpacked];
while (pending.length > 0) {
  const current = pending.pop();
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) pending.push(target);
    else {
      if (forbiddenNames.test(entry.name)) fail(`Forbidden runtime artifact in package: ${entry.name}`);
      const bytes = fs.readFileSync(target);
      if (forbiddenContent.test(bytes.toString('latin1'))) fail(`Forbidden credential or token in package: ${entry.name}`);
      if (forbiddenDigests.some((digest) => bytes.includes(Buffer.from(digest)))) fail(`Fixture password digest in package: ${entry.name}`);
    }
  }
}

const verificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-package-verify-'));
try {
  let result;
  const attemptStatuses = [];
  const transientNativeStatuses = new Set([3221225477, 3221225781, -1073741819, -1073741515]);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const userData = path.join(verificationRoot, `attempt-${attempt}`);
    result = childProcess.spawnSync(executable, ['--verify'], {
      env: { ...process.env, RZ_RUNTIME_USER_DATA: userData },
      windowsHide: true,
      timeout: 30_000
    });
    if (result.error) fail(`Packaged executable failed to start: ${result.error.message}`);
    attemptStatuses.push(result.status);
    if (result.status === 0) break;
    if (!transientNativeStatuses.has(result.status)) break;
  }
  if (result.status !== 0) fail(`Packaged executable self-check exited with ${result.status}.`);
  const reports = path.join(__dirname, '..', 'dist', 'reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, 'package-verification.json'), `${JSON.stringify({
    status: 'passed', productName: blueprint.software.name,
    executableSha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    resourceManifestSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(runtimeResources, 'resource-manifest.json'))).digest('hex'),
    attemptStatuses,
    verifiedAt: new Date().toISOString()
  }, null, 2)}\n`, 'utf8');
  process.stdout.write('Package verification passed.\n');
} finally {
  fs.rmSync(verificationRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
