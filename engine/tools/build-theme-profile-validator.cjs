'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const standaloneCode = require('ajv/dist/standalone').default;

const root = path.resolve(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'config', 'theme-profile.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, code: { source: true } });
const validate = ajv.compile(schema);
const source = `'use strict';\n${standaloneCode(ajv, validate)}`
  .replaceAll('require("ajv/dist/runtime/equal").default', 'require("node:util").isDeepStrictEqual')
  .replaceAll('require("ajv/dist/runtime/ucs2length").default', '((value) => [...value].length)');
if (/require\(["']ajv\//.test(source)) throw new Error('Generated theme validator depends on Ajv runtime.');
const output = path.join(root, 'theme-profile', 'generated', 'validate-theme-profile-structure.cjs');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, source, 'utf8');
