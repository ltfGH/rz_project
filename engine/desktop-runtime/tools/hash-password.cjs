'use strict';

require('tsx/cjs');
const { hashPassword } = require('../src/core/passwords.ts');

const password = process.env.RZ_PASSWORD;
if (!password) {
  process.stderr.write('Set RZ_PASSWORD before running this command.\n');
  process.exit(2);
}
hashPassword(password).then((digest) => process.stdout.write(`${digest}\n`)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
