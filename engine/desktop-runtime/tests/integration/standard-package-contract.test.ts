import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

import { assembleStandardResources } from '../../src/generator/resource-assembler';
import { standardRequest } from '../helpers/standard-generation';

const root = path.resolve(__dirname, '..', '..');
const writer = path.join(root, 'tools', 'write-builder-config.cjs');

function buildConfig(temp: string, templateId: string, softwareId: string, name: string) {
  const request = structuredClone(standardRequest(templateId));
  request.software.id = softwareId;
  request.software.name = name;
  request.profile.softwareName = name;
  const resources = path.join(temp, `${templateId}-resources`);
  const output = path.join(temp, `${templateId}.yml`);
  const installers = path.join(temp, `${templateId}-installers`);
  assembleStandardResources(request, resources);
  const result = spawnSync(process.execPath, [writer,
    '--resources', resources, '--output', output, '--installers', installers, '--app-root', root
  ], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return parse(fs.readFileSync(output, 'utf8')) as Record<string, any>;
}

test('writes isolated deterministic builder configs from locked resources', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-builder-config-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const asset = buildConfig(temp, 'asset_inspection_rectification', 'campus_asset_ops', 'Campus Asset Operations');
  const project = buildConfig(temp, 'project_task_management', 'project_delivery_ops', 'Project Delivery Operations');
  assert.notEqual(asset.appId, project.appId);
  assert.match(asset.appId, /^cn\.rzproject\.generated\.[a-f0-9]{16}$/);
  assert.equal(asset.productName, 'Campus Asset Operations');
  assert.equal(asset.win.executableName, 'Campus Asset Operations');
  assert.equal(asset.artifactName, '${productName} V${version} 安装包.${ext}');
  assert.equal(asset.asar, true);
  assert.equal(asset.npmRebuild, false);
  assert.equal(asset.win.signAndEditExecutable, false);
  assert.deepEqual(asset.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(asset.nsis.oneClick, false);
  assert.equal(asset.nsis.perMachine, false);
  assert.equal(asset.nsis.deleteAppDataOnUninstall, false);
  assert.notEqual(asset.directories.output, project.directories.output);
  assert.notEqual(asset.extraResources[0].from, project.extraResources[0].from);
});

test('rejects unsafe product names and non-resource paths', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-builder-reject-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const request = structuredClone(standardRequest('project_task_management'));
  request.software.name = 'Bad/Name';
  request.profile.softwareName = 'Bad/Name';
  const resources = path.join(temp, 'resources');
  assembleStandardResources(request, resources);
  const output = path.join(temp, 'config.yml');
  const result = spawnSync(process.execPath, [writer,
    '--resources', resources, '--output', output, '--installers', path.join(temp, 'out'), '--app-root', root
  ], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(output), false);
  const missing = spawnSync(process.execPath, [writer,
    '--resources', path.join(temp, 'missing'), '--output', output,
    '--installers', path.join(temp, 'out'), '--app-root', root
  ], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(missing.status, 2);
});
