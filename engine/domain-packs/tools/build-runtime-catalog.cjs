'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputArgument = process.argv.indexOf('--outfile');
const output = outputArgument >= 0
  ? path.resolve(process.argv[outputArgument + 1])
  : path.join(root, 'dist', 'production-runtime-catalog.cjs');

if (outputArgument >= 0 && !process.argv[outputArgument + 1]) {
  throw new Error('--outfile requires a path.');
}

fs.mkdirSync(path.dirname(output), { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'runtime', 'production-catalog.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  external: ['electron']
});

const source = fs.readFileSync(output, 'utf8');
if (/require\(["'](?:tsx|typescript)["']\)/.test(source)) {
  throw new Error('Generated runtime catalog contains a development runtime dependency.');
}
