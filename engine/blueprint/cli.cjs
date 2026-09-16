'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { validateBlueprint } = require('./validate.cjs');

const MAX_BLUEPRINT_BYTES = 5 * 1024 * 1024;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function main(args) {
  if (args.length !== 2 || args[0] !== '--input') {
    fail('Usage: node cli.cjs --input <absolute-json-path>');
    return;
  }

  const inputPath = args[1];
  if (!path.isAbsolute(inputPath)) {
    fail('Blueprint input path must be absolute.');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    fail('Blueprint input path must reference an existing regular file.');
    return;
  }
  if (!stat.isFile()) {
    fail('Blueprint input path must reference an existing regular file.');
    return;
  }
  if (stat.size > MAX_BLUEPRINT_BYTES) {
    fail('Blueprint input file must not exceed 5 MiB.');
    return;
  }

  let blueprint;
  try {
    blueprint = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch {
    fail('Blueprint input must contain valid JSON.');
    return;
  }

  const result = validateBlueprint(blueprint);
  process.stdout.write(JSON.stringify(result));
  process.exitCode = result.canGenerate ? 0 : 1;
}

main(process.argv.slice(2));
