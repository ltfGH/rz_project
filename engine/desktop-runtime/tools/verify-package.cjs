'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--unpacked' || !path.isAbsolute(args[1])) {
  fail('Usage: node verify-package.cjs --unpacked <absolute-directory>');
}
const unpacked = path.resolve(args[1]);
const executable = path.join(unpacked, '离线任务协同管理软件.exe');
const resources = path.join(unpacked, 'resources');
for (const required of [
  executable,
  path.join(resources, 'app.asar'),
  path.join(resources, 'runtime-resources', 'blueprint.json'),
  path.join(resources, 'runtime-resources', 'seed.json'),
  path.join(resources, 'runtime-resources', 'resource-manifest.json')
]) {
  if (!fs.statSync(required).isFile()) fail(`Missing packaged file: ${required}`);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-package-verify-'));
try {
  const result = childProcess.spawnSync(executable, ['--verify'], {
    env: { ...process.env, RZ_RUNTIME_USER_DATA: userData },
    windowsHide: true,
    timeout: 30_000
  });
  if (result.error) fail(`Packaged executable failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`Packaged executable self-check exited with ${result.status}.`);
  process.stdout.write('Package verification passed.\n');
} finally {
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
