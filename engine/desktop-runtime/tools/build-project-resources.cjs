'use strict';

require('tsx/cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const domainRoot = path.resolve(root, '..', 'domain-packs');

function fail(message) { process.stderr.write(`${message}\n`); process.exit(2); }
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

const projectArgument = argument('--project');
const outputArgument = argument('--output');
if (!projectArgument || !outputArgument) {
  fail('Usage: build-project-resources --project <json> --output <directory>');
}
const projectPath = path.resolve(projectArgument);
const outputPath = path.resolve(outputArgument);
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
const accounts = JSON.parse(fs.readFileSync(path.join(path.dirname(projectPath), 'accounts.json'), 'utf8'));
const packRoots = project.packs.map((pack) => path.join(domainRoot, 'packs', pack.id));
const envelope = {
  packs: packRoots,
  composition: {
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0', software: project.software,
    selections: project.packs.map((pack) => ({ id: pack.id, version: '1.0.0', config: pack.config })),
    coverage: { supported: ['资产台账', '巡检闭环', '整改工单'], unsupported: [] },
    materials: { developmentPurpose: '形成可追溯的资产巡检整改闭环', industry: '企业运维', technicalFeatures: ['Electron离线运行', 'SQLite事务', '角色权限'] }
  }
};

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-compose-'));
try {
  const requestPath = path.join(temporary, 'request.json');
  const composeOutput = path.join(temporary, 'composed');
  fs.writeFileSync(requestPath, canonical(envelope), 'utf8');
  const compose = spawnSync(process.execPath, [path.join(domainRoot, 'bin', 'domain-pack-cli.cjs'), '--request', requestPath, '--output', composeOutput], { cwd: domainRoot, encoding: 'utf8', windowsHide: true });
  if (compose.status !== 0) fail(compose.stderr || compose.stdout || 'Domain composition failed.');
  const blueprintText = fs.readFileSync(path.join(composeOutput, 'blueprint.json'), 'utf8');
  const domainText = fs.readFileSync(path.join(composeOutput, 'domain-lock.json'), 'utf8');
  const blueprint = JSON.parse(blueprintText);
  const domainLock = JSON.parse(domainText);
  const { generateReferenceSeed } = require('../reference/asset-operations/generate-seed.ts');
  const seed = generateReferenceSeed({
    seed: project.seed.value, businessRows: project.seed.businessRows, baseline: project.seed.baseline,
    passwordDigests: Object.fromEntries(Object.entries(accounts).map(([id, account]) => [id, account.passwordDigest]))
  });
  const seedText = canonical(seed);
  const catalogPath = path.join(temporary, 'production-runtime-catalog.cjs');
  const catalogBuild = spawnSync(process.execPath, [path.join(domainRoot, 'tools', 'build-runtime-catalog.cjs'), '--outfile', catalogPath], { cwd: domainRoot, encoding: 'utf8', windowsHide: true });
  if (catalogBuild.status !== 0) fail(catalogBuild.stderr || catalogBuild.stdout || 'Production runtime catalog build failed.');
  const catalog = fs.readFileSync(catalogPath);
  const { compileSchema } = require('../src/core/schema-compiler.ts');
  const { createProjectLock, canonicalProjectLock } = require('../src/core/project-lock.ts');
  const packageJson = require('../package.json');
  const lock = createProjectLock({
    generatorVersion: '1.0.0', blueprintSchemaVersion: '1.0', domainLock,
    databaseSchemaVersion: compileSchema(blueprint).version,
    desktopRuntimeVersion: packageJson.version,
    electronVersion: require('../node_modules/electron/package.json').version,
    nodeVersion: process.versions.node, sqliteVersion: process.versions.sqlite ?? 'unknown',
    projectConfig: project, buildTarget: 'win-nsis-x64'
  });
  const projectText = canonicalProjectLock(lock);
  const resources = {
    'blueprint.json': Buffer.from(blueprintText), 'seed.json': Buffer.from(seedText),
    'domain-lock.json': Buffer.from(domainText), 'project.lock.json': Buffer.from(projectText),
    'production-runtime-catalog.cjs': catalog
  };
  const manifest = Buffer.from(JSON.stringify({ manifestVersion: '1.0', files: Object.fromEntries(Object.entries(resources).map(([name, bytes]) => [name, hash(bytes)])) }, null, 2));
  const parent = path.dirname(outputPath);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(outputPath)}.staging-${crypto.randomUUID()}`);
  const backup = path.join(parent, `.${path.basename(outputPath)}.previous-${crypto.randomUUID()}`);
  fs.mkdirSync(staging);
  for (const [name, bytes] of Object.entries(resources)) fs.writeFileSync(path.join(staging, name), bytes);
  fs.writeFileSync(path.join(staging, 'resource-manifest.json'), manifest);
  let movedPrevious = false;
  try {
    if (fs.existsSync(outputPath)) { fs.renameSync(outputPath, backup); movedPrevious = true; }
    fs.renameSync(staging, outputPath);
    if (movedPrevious) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (movedPrevious && !fs.existsSync(outputPath)) fs.renameSync(backup, outputPath);
    throw error;
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
