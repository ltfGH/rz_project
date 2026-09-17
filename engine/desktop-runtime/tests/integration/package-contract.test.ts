import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

test('configures a per-user x64 NSIS package with isolated user data', () => {
  const configPath = path.resolve(__dirname, '..', '..', 'electron-builder.yml');
  const config = parse(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;

  assert.equal(config.appId, 'cn.rzproject.desktop.runtime');
  assert.equal(config.productName, '离线任务协同管理软件');
  assert.equal(config.asar, true);
  assert.equal(config.npmRebuild, false);
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(config.win.signAndEditExecutable, false);
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.differentialPackage, false);
  assert.equal(config.win.icon, 'build/icon.svg');
  assert.equal(config.artifactName, '${productName} V${version} 安装包.${ext}');
  assert.deepEqual(config.files, [
    'dist/runtime/**/*',
    'dist/renderer/**/*',
    'package.json'
  ]);
  assert.deepEqual(config.extraResources, [
    { from: 'dist/resources', to: 'runtime-resources', filter: ['**/*'] }
  ]);
});
