'use strict';

if (process.env.RZ_SKIP_REFERENCE_E2E === '1') process.exit(0);
const required = [
  'RZ_E2E_DISPATCHER_PASSWORD', 'RZ_E2E_OPERATOR_PASSWORD',
  'RZ_E2E_REVIEWER_PASSWORD', 'RZ_E2E_ADMINISTRATOR_PASSWORD'
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  process.stderr.write(`Missing reference E2E variables: ${missing.join(', ')}\n`);
  process.exit(2);
}
