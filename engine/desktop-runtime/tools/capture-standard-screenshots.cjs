'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function requiredPath(name, kind) {
  const value = argument(name);
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  if (kind === 'file' && !fs.statSync(value).isFile()) throw new Error(`${name} must name a file.`);
  return path.resolve(value);
}
function sha256(filename) { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }

async function main() {
  const executablePath = requiredPath('--executable', 'file');
  const blueprintPath = requiredPath('--blueprint', 'file');
  const planPath = requiredPath('--plan', 'file');
  const output = requiredPath('--output', 'directory');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
  const modules = new Map(blueprint.modules.map((module) => [module.id, module]));
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rz-standard-capture-'));
  let app;
  try {
    app = await electron.launch({ executablePath, env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
    const page = await app.firstWindow();
    await page.getByLabel('账号').fill('administrator');
    await page.getByLabel('密码').fill(process.env.RZ_E2E_ADMINISTRATOR_PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
    const captures = [];
    for (const item of plan) {
      await page.setViewportSize(item.viewport === 'mobile' ? { width: 430, height: 932 } : { width: 1440, height: 960 });
      if (item.kind === 'dashboard') {
        await page.getByRole('button', { name: '运维总览', exact: true }).click();
      } else {
        const module = modules.get(item.moduleId);
        if (!module) throw new Error(`Capture plan references unknown module '${item.moduleId}'.`);
        await page.getByRole('button', { name: module.name, exact: true }).click();
        await page.getByPlaceholder('搜索记录').waitFor();
        if (item.kind === 'detail' || item.kind === 'action') {
          const view = page.getByRole('button', { name: /^查看 / }).first();
          await view.waitFor();
          await view.click();
          await page.getByRole('complementary', { name: '记录详情' }).waitFor();
        }
      }
      const filename = path.join(output, item.fileName);
      await page.screenshot({ path: filename, fullPage: true });
      captures.push({
        id: item.id, kind: item.kind, moduleId: item.moduleId, actionId: item.actionId,
        path: item.fileName, viewport: item.viewport, sha256: sha256(filename)
      });
    }
    fs.writeFileSync(path.join(output, 'screenshot-manifest.json'), JSON.stringify({
      manifestVersion: '1.0', executableSha256: sha256(executablePath), blueprintSha256: sha256(blueprintPath), captures
    }, null, 2), 'utf8');
  } finally {
    if (app) await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
