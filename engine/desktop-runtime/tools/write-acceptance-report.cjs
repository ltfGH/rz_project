'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function count(name) {
  const value = Number(argument(name));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}
function status(name) {
  const value = argument(name);
  if (!['passed', 'failed', 'blocked'].includes(value)) throw new Error(`${name} must be passed, failed or blocked.`);
  return value;
}
function sha256(filename) { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
function evidence(name) {
  const filename = path.join(root, 'dist', 'reports', `${name}-verification.json`);
  if (!fs.existsSync(filename)) throw new Error(`Missing ${name} verification receipt.`);
  const value = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (value.status !== 'passed') throw new Error(`${name} verification receipt did not pass.`);
  return value;
}

const resources = path.join(root, 'dist', 'resources');
const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'resource-manifest.json'), 'utf8'));
const blueprint = JSON.parse(fs.readFileSync(path.join(resources, 'blueprint.json'), 'utf8'));
const seed = JSON.parse(fs.readFileSync(path.join(resources, 'seed.json'), 'utf8'));
const domainLock = JSON.parse(fs.readFileSync(path.join(resources, 'domain-lock.json'), 'utf8'));
const versions = new Map(domainLock.packs.map(({ id, version }) => [id, version]));
for (const [name, expected] of Object.entries(manifest.files)) {
  if (sha256(path.join(resources, name)) !== expected) throw new Error(`Resource digest mismatch: ${name}`);
}
const packageStatus = status('--package');
const installerStatus = status('--installer');
const restartStatus = status('--restart');
if (packageStatus === 'passed') {
  const receipt = evidence('package');
  const executable = path.join(root, 'dist', 'installers', 'win-unpacked', `${blueprint.software.name}.exe`);
  if (sha256(executable) !== receipt.executableSha256) throw new Error('Package verification receipt is stale.');
  if (sha256(path.join(resources, 'resource-manifest.json')) !== receipt.resourceManifestSha256) {
    throw new Error('Package resource verification receipt is stale.');
  }
}
if (installerStatus === 'passed') {
  const receipt = evidence('installer');
  const installer = path.join(root, 'dist', 'installers', receipt.installerName);
  if (sha256(installer) !== receipt.installerSha256) throw new Error('Installer verification receipt is stale.');
}
if (restartStatus === 'passed') {
  const filename = path.join(root, 'test-results', 'reference-acceptance-status.json');
  if (!fs.existsSync(filename)) throw new Error('Missing reference E2E status receipt.');
  const receipt = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (receipt.status !== 'passed' || receipt.restartPersistence !== true) throw new Error('Reference E2E status receipt did not pass.');
}
const output = {
  reportVersion: '1.0',
  generatedAt: new Date().toISOString(),
  software: { id: blueprint.software.id, name: blueprint.software.name, version: blueprint.software.version },
  resources: manifest.files,
  seed: seed.report,
  plugins: blueprint.plugins.map(({ id }) => ({ id, version: versions.get(id) })),
  views: blueprint.modules.map(({ id, name }) => ({ id, name })),
  roles: ['operations_dispatcher', 'operations_operator', 'operations_reviewer', 'operations_admin'],
  tests: {
    domainUnit: count('--domain-unit'),
    domainIntegration: count('--domain-integration'),
    combinations: count('--combinations'),
    desktopUnit: count('--desktop-unit'),
    desktopIntegration: count('--desktop-integration')
  },
  restartPersistence: restartStatus,
  packageVerification: packageStatus,
  installerVerification: installerStatus
};
const outputDirectory = path.join(root, 'dist', 'reports');
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, 'reference-acceptance.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write('Wrote dist/reports/reference-acceptance.json\n');
