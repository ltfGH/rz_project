import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDatabase } from '../../src/core/database';
import { compileSchema } from '../../src/core/schema-compiler';
import { seedProjectData } from '../../src/core/seed';
import { generateStandardSeed } from '../../src/generator/standard-seed';
import { loadStandardTemplateCatalog } from '../../src/generator/standard-project';
import { builtTemplate, testDigests } from '../helpers/standard-generation';

test('seeds every standard template into real SQLite idempotently', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-seed-db-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const descriptor of loadStandardTemplateCatalog().templates) {
    const built = builtTemplate(descriptor);
    const seed = generateStandardSeed(built.project, built.blueprint, testDigests);
    const database = openDatabase({ filename: path.join(root, `${descriptor.id}.sqlite`) });
    try {
      database.migrate(compileSchema(built.blueprint));
      seedProjectData(database, seed);
      seedProjectData(database, seed);
      let total = 0;
      for (const [entity, expected] of Object.entries(seed.report.counts)) {
        const row = database.prepare(`SELECT COUNT(*) count FROM biz_${entity}`).get() as { count: number };
        assert.equal(row.count, expected, `${descriptor.id}:${entity}`);
        total += row.count;
      }
      assert.equal(total, 1000);
      assert.equal((database.prepare('SELECT COUNT(*) count FROM sys_user').get() as { count: number }).count, 4);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { database.close(); }
  }
});
