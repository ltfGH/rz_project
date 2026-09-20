'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'resources');
const blueprintSource = path.join(root, 'fixtures', 'runtime-blueprint.json');
const seedSource = path.join(root, 'fixtures', 'runtime-seed.json');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const blueprint = fs.readFileSync(blueprintSource);
const seed = fs.readFileSync(seedSource);
fs.copyFileSync(blueprintSource, path.join(output, 'blueprint.json'));
fs.copyFileSync(seedSource, path.join(output, 'seed.json'));

const domainLock = {
  lockVersion: '1.0', blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
  dependencyOrder: [], packs: []
};
const domainText = JSON.stringify(domainLock, null, 2);
fs.writeFileSync(path.join(output, 'domain-lock.json'), domainText, 'utf8');

const { createProjectLock, canonicalProjectLock } = require('../dist/runtime/core/project-lock.js');
const packageJson = require('../package.json');
const electronVersion = require('../node_modules/electron/package.json').version;
const projectLock = createProjectLock({
  generatorVersion: '1.0.0', blueprintSchemaVersion: '1.0', domainLock,
  databaseSchemaVersion: 1, desktopRuntimeVersion: packageJson.version,
  electronVersion, nodeVersion: process.versions.node,
  sqliteVersion: process.versions.sqlite ?? 'unknown',
  projectConfig: JSON.parse(blueprint.toString('utf8')),
  buildTarget: 'win-nsis-x64'
});
const projectText = canonicalProjectLock(projectLock);
fs.writeFileSync(path.join(output, 'project.lock.json'), projectText, 'utf8');

const catalog = 'module.exports={productionPluginDescriptors:Object.freeze([])};\n';
fs.writeFileSync(path.join(output, 'production-runtime-catalog.cjs'), catalog, 'utf8');

const files = {
  'blueprint.json': blueprint,
  'seed.json': seed,
  'domain-lock.json': Buffer.from(domainText),
  'project.lock.json': Buffer.from(projectText),
  'production-runtime-catalog.cjs': Buffer.from(catalog)
};
fs.writeFileSync(path.join(output, 'resource-manifest.json'), JSON.stringify({
  manifestVersion: '1.0',
  files: Object.fromEntries(Object.entries(files).map(([name, content]) => [
    name, crypto.createHash('sha256').update(content).digest('hex')
  ]))
}, null, 2), 'utf8');
