'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'bin', 'domain-pack-cli.cjs');
fs.mkdirSync(path.dirname(output), { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'cli.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none'
});

const source = fs.readFileSync(output, 'utf8');
if (/require\(["'](?:zod|tsx|typescript)/.test(source)) {
  throw new Error('Generated domain pack CLI contains an external runtime dependency.');
}
