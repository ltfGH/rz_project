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
fs.copyFileSync(blueprintSource, path.join(output, 'blueprint.json'));
fs.copyFileSync(seedSource, path.join(output, 'seed.json'));
fs.writeFileSync(path.join(output, 'resource-manifest.json'), JSON.stringify({
  blueprintSha256: crypto.createHash('sha256').update(blueprint).digest('hex')
}, null, 2), 'utf8');
