'use strict';

require('tsx/cjs');
const fs = require('node:fs');
const path = require('node:path');
const { assembleStandardResources } = require('../src/generator/resource-assembler.ts');

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(2); }
const requestValue = argument('--request');
const outputValue = argument('--output');
if (!requestValue || !outputValue || !path.isAbsolute(requestValue) || !path.isAbsolute(outputValue)) {
  fail('Usage: build-standard-resources --request <absolute-json> --output <absolute-directory>');
}
try {
  const stat = fs.lstatSync(requestValue);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('Request must be a regular JSON file no larger than 1 MiB.');
  const request = JSON.parse(fs.readFileSync(requestValue, 'utf8'));
  assembleStandardResources(request, outputValue);
  process.stdout.write(`${JSON.stringify({ ok: true, output: path.basename(outputValue) })}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
