import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { composeProduction } from '../../../domain-packs/tests/helpers/production-packs';
import {
  createStandardProject,
  loadStandardTemplateCatalog,
  type StandardProjectRequest
} from '../../src/generator/standard-project';

const desktopRoot = path.resolve(__dirname, '..', '..');
const engineCatalog = JSON.parse(fs.readFileSync(
  path.resolve(desktopRoot, '..', 'config', 'standard-business-templates.json'), 'utf8'
));
const digests = Object.freeze({
  dispatcher: 'scrypt$16384$8$1$ZGlzcGF0Y2hlci1zYWx0MQ==$QXkC+g8WOmnKNAtrJeN3u/VUr1oSHxVcbaXJuF8AyuA5VAWwdgvxrpk7xuMHToK0TXjz/gCY7Gbozbov/epFfg==',
  operator: 'scrypt$16384$8$1$b3BlcmF0b3Itc2FsdC0wMQ==$RgRfB1/ZuasinXeYj+agQRjdSxLJLmyUs+4hc7obWE+s4CyE03Kb+Gnm3OQvRDqVL3yNzmc0nYC5MYFzetFgDw==',
  reviewer: 'scrypt$16384$8$1$cmV2aWV3ZXItc2FsdC0wMQ==$E0nzK8Ax/fc6WHYkcKcHp4gRu9IPx/mDI95Y4tcXF5UzqZNTg0bwyjezydD6AxKr/HXr7PjWPTpQ6GKfGiZ6tA==',
  administrator: 'scrypt$16384$8$1$YWRtaW4tc2FsdC0wMDAxMjM0NQ==$zkr0AzJ03NzoUsSpq5N8ZEtBMxwLhmSnKpSDvQr84EqcBJVDlkrJwQXr8LBN5cJ83EwNbwojZoA/47Bx8r1aLw=='
});

function request(templateId: string): StandardProjectRequest {
  return {
    templateId,
    appId: '11111111-2222-4333-8444-555555555555',
    software: {
      id: `generated_${templateId}`.slice(0, 63), name: 'Campus Operations Software', version: '1.0.0',
      purpose: 'Manage verified offline operations.', targetUsers: ['Operator'],
      boundaries: ['Offline desktop'], loginMode: 'required'
    },
    profile: {
      softwareName: 'Campus Operations Software', purpose: 'Manage verified offline operations.',
      industry: 'Campus operations', entityAliases: {}, moduleAliases: {},
      seedVocabulary: { names: ['Pump', 'Valve'] }
    },
    passwordDigests: digests,
    seed: { value: 20260921, businessRows: 1000, baseline: '2026-09-21T00:00:00.000Z' }
  };
}

test('catalog matches all eight engine templates and exact production pack versions', () => {
  const catalog = loadStandardTemplateCatalog();
  assert.equal(catalog.templates.length, 8);
  assert.deepEqual(catalog.templates.map((entry) => entry.id), engineCatalog.templates.map((entry: any) => entry.id));
  for (const entry of catalog.templates) {
    const engineEntry = engineCatalog.templates.find((candidate: any) => candidate.id === entry.id);
    assert.deepEqual(entry.packs.map((pack) => pack.id), engineEntry.packs);
    assert.ok(entry.packs.every((pack) => pack.version === '1.0.0'));
    assert.equal(entry.seed.targetBusinessRows, 1000);
    assert.equal(Object.keys(entry.roleProfiles).length, 4);
  }
});

test('builds four composite roles from real composed roles for every template', () => {
  const catalog = loadStandardTemplateCatalog();
  for (const descriptor of catalog.templates) {
    const composition = composeProduction(descriptor.packs.map((pack) => pack.id));
    assert.equal(composition.canGenerate, true, `${descriptor.id}: ${composition.summary}`);
    assert.ok(composition.blueprint);
    const built = createStandardProject(request(descriptor.id), catalog, composition.blueprint as any);
    const roles = built.blueprint.roles ?? [];
    for (const id of ['operations_dispatcher', 'operations_operator', 'operations_reviewer', 'operations_admin']) {
      const role = roles.find((candidate) => candidate.id === id);
      assert.ok(role, `${descriptor.id} missing ${id}`);
      assert.equal(new Set(role.permissions).size, role.permissions.length);
      assert.ok(role.permissions.length > 0);
    }
    assert.equal(built.blueprint.modules?.some((module) => module.id === 'maintenance'), true);
    assert.deepEqual(built.project.packs.map((pack) => pack.id), descriptor.packs.map((pack) => pack.id));
    assert.equal(Object.isFrozen(built), true);
    assert.equal(Object.isFrozen(built.blueprint.roles), true);
  }
});

test('uses the approved reference role sources and applies only allowed aliases', () => {
  const catalog = loadStandardTemplateCatalog();
  const descriptor = catalog.templates.find((entry) => entry.id === 'asset_inspection_rectification')!;
  assert.deepEqual(descriptor.roleProfiles.operations_dispatcher.sources, [
    'asset_viewer', 'inspection_planner', 'work_order_dispatcher'
  ]);
  assert.deepEqual(descriptor.roleProfiles.operations_operator.sources, [
    'asset_viewer', 'inspection_executor', 'work_order_handler'
  ]);
  assert.deepEqual(descriptor.roleProfiles.operations_reviewer.sources, [
    'asset_viewer', 'inspection_reviewer', 'work_order_reviewer'
  ]);
  const composition = composeProduction(descriptor.packs.map((pack) => pack.id));
  const input = request(descriptor.id);
  input.profile.entityAliases.asset = 'Facility';
  input.profile.moduleAliases.assets = 'Facilities';
  const built = createStandardProject(input, catalog, composition.blueprint as any);
  assert.equal(built.blueprint.entities?.find((entry) => entry.id === 'asset')?.name, 'Facility');
  assert.equal(built.blueprint.modules?.find((entry) => entry.id === 'assets')?.name, 'Facilities');
  assert.throws(() => {
    const hostile = request(descriptor.id);
    hostile.profile.entityAliases.unknown_entity = 'Unknown';
    createStandardProject(hostile, catalog, composition.blueprint as any);
  }, /alias/i);
});

test('rejects unknown templates, malformed app ids and unavailable role sources', () => {
  const catalog = loadStandardTemplateCatalog();
  const descriptor = catalog.templates[0]!;
  const composition = composeProduction(descriptor.packs.map((pack) => pack.id));
  assert.throws(() => createStandardProject(request('missing_template'), catalog, composition.blueprint as any), /template/i);
  const badApp = request(descriptor.id);
  badApp.appId = 'not-a-guid';
  assert.throws(() => createStandardProject(badApp, catalog, composition.blueprint as any), /appId/);
  const altered = structuredClone(catalog);
  altered.templates[0]!.roleProfiles.operations_dispatcher.sources = ['missing_role'];
  assert.throws(() => createStandardProject(request(descriptor.id), altered, composition.blueprint as any), /role source/i);
});
