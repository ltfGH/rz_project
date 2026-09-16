'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const standaloneCode = require('ajv/dist/standalone').default;

const engineRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(engineRoot, 'config', 'blueprint.schema.json');
const outputPath = path.join(
  engineRoot,
  'blueprint',
  'generated',
  'validate-blueprint-structure.cjs'
);

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  code: { source: true }
});
const validate = ajv.compile(schema);
const source = `'use strict';\n${standaloneCode(ajv, validate)}`
  .replaceAll(
    'require("ajv/dist/runtime/equal").default',
    'require("node:util").isDeepStrictEqual'
  )
  .replaceAll(
    'require("ajv/dist/runtime/ucs2length").default',
    '((value) => [...value].length)'
  );

if (/require\(["']ajv\//.test(source)) {
  throw new Error('Generated validator contains an unbundled Ajv runtime dependency.');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, source, 'utf8');
