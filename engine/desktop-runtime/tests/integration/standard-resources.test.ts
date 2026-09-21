import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { verifyProjectResources } from '../../src/core/project-lock';
import { assembleStandardResources } from '../../src/generator/resource-assembler';
import { loadStandardTemplateCatalog } from '../../src/generator/standard-project';
import { standardRequest } from '../helpers/standard-generation';

const RESOURCE_NAMES = [
  'blueprint.json', 'seed.json', 'domain-lock.json', 'project.lock.json',
  'production-runtime-catalog.cjs', 'resource-manifest.json'
];

test('assembles deterministic locked resources for all eight templates', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-resources-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const descriptor of loadStandardTemplateCatalog().templates) {
    const first = path.join(root, `${descriptor.id}-first`);
    const second = path.join(root, `${descriptor.id}-second`);
    assembleStandardResources(standardRequest(descriptor.id), first);
    assembleStandardResources(standardRequest(descriptor.id), second);
    for (const name of RESOURCE_NAMES) {
      assert.deepEqual(fs.readFileSync(path.join(first, name)), fs.readFileSync(path.join(second, name)), `${descriptor.id}:${name}`);
    }
    const verified = verifyProjectResources(first);
    const blueprint = JSON.parse(verified.blueprintText);
    const seed = JSON.parse(verified.seedText);
    assert.deepEqual(blueprint.plugins.map((entry: any) => entry.id).sort(), descriptor.packs.map((entry) => entry.id).sort());
    assert.equal(seed.report.countedBusinessRows, 1000);
    assert.equal(seed.users.length, 4);
  }
});

test('rejects unknown templates, partial digests and nonempty output without publication', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-resource-reject-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unknown = standardRequest('missing_template');
  assert.throws(() => assembleStandardResources(unknown, path.join(root, 'unknown')), /template/i);
  const partial: any = structuredClone(standardRequest('project_task_management'));
  delete partial.passwordDigests.reviewer;
  assert.throws(() => assembleStandardResources(partial, path.join(root, 'partial')), /passwordDigests|reviewer/i);
  const occupied = path.join(root, 'occupied');
  fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, 'keep.txt'), 'keep');
  assert.throws(() => assembleStandardResources(standardRequest('project_task_management'), occupied), /empty|exist/i);
  assert.equal(fs.readFileSync(path.join(occupied, 'keep.txt'), 'utf8'), 'keep');
});
