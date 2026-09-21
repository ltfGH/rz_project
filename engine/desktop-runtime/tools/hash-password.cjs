'use strict';

require('tsx/cjs');
const fs = require('node:fs');
const { hashPassword } = require('../src/core/passwords.ts');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const stdinMode = process.argv.slice(2).includes('--stdin');
if (process.argv.slice(2).some((value) => value !== '--stdin') || process.argv.slice(2).filter((value) => value === '--stdin').length > 1) {
  fail('Usage: node hash-password.cjs [--stdin]');
}
let password = '';
if (stdinMode) {
  const input = fs.readFileSync(0, 'utf8');
  const normalized = input.endsWith('\r\n') ? input.slice(0, -2) : input.endsWith('\n') ? input.slice(0, -1) : input;
  if (!normalized || /[\r\n]/.test(normalized)) fail('Expected exactly one non-empty password line on stdin.');
  password = normalized;
} else {
  password = process.env.RZ_PASSWORD ?? '';
  if (!password) fail('Set RZ_PASSWORD before running this command.');
}

void hashPassword(password).then((digest) => {
  process.stdout.write(`${digest}\n`);
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}).finally(() => {
  password = '';
});
