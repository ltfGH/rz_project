'use strict';

require('tsx/cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stringify } = require('yaml');
const { verifyProjectResources } = require('../src/core/project-lock.ts');

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(2); }
const resourcesValue = argument('--resources');
const outputValue = argument('--output');
const installersValue = argument('--installers');
const appRootValue = argument('--app-root');
if (![resourcesValue, outputValue, installersValue, appRootValue].every((value) => value && path.isAbsolute(value))) {
  fail('Usage: write-builder-config --resources <absolute-dir> --output <absolute-yml> --installers <absolute-dir> --app-root <absolute-dir>');
}

try {
  const resources = path.resolve(resourcesValue);
  const output = path.resolve(outputValue);
  const installers = path.resolve(installersValue);
  const appRoot = path.resolve(appRootValue);
  if (fs.existsSync(output)) fail('Builder config output already exists.');
  if (!fs.existsSync(appRoot) || !fs.statSync(appRoot).isDirectory()) fail('Application root does not exist.');
  const verified = verifyProjectResources(resources);
  const blueprint = JSON.parse(verified.blueprintText);
  const productName = String(blueprint.software?.name ?? '').trim();
  const softwareId = String(blueprint.software?.id ?? '').trim();
  const invalidName = /[<>:"/\\|?*\x00-\x1f]|[. ]$/;
  const reservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (!productName || productName.length > 80 || invalidName.test(productName) || reservedName.test(productName)) {
    fail('Packaged product name is not safe for Windows.');
  }
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(softwareId)) fail('Packaged software id is invalid.');
  const appId = `cn.rzproject.generated.${crypto.createHash('sha256').update(softwareId).digest('hex').slice(0, 16)}`;
  const config = {
    appId,
    productName,
    artifactName: '${productName} V${version} 安装包.${ext}',
    asar: true,
    npmRebuild: false,
    compression: 'normal',
    directories: { app: appRoot, buildResources: path.join(appRoot, 'build'), output: installers },
    files: ['dist/runtime/**/*', 'dist/renderer/**/*', 'package.json'],
    extraResources: [{ from: resources, to: 'runtime-resources', filter: ['**/*'] }],
    win: {
      executableName: productName,
      icon: path.join(appRoot, 'build', 'icon.svg'),
      signAndEditExecutable: false,
      target: [{ target: 'nsis', arch: ['x64'] }]
    },
    nsis: {
      differentialPackage: false, oneClick: false, perMachine: false,
      allowToChangeInstallationDirectory: true, createDesktopShortcut: true,
      createStartMenuShortcut: true, deleteAppDataOnUninstall: false, runAfterFinish: false
    }
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, stringify(config), 'utf8');
  process.stdout.write(`${JSON.stringify({ appId, productName, output: path.basename(output) })}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
