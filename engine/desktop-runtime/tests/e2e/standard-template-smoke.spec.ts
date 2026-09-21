import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const required = [
  'RZ_E2E_TEMPLATE_ID', 'RZ_E2E_EXECUTABLE_PATH', 'RZ_E2E_RECEIPT_PATH',
  'RZ_E2E_DISPATCHER_PASSWORD', 'RZ_E2E_OPERATOR_PASSWORD',
  'RZ_E2E_REVIEWER_PASSWORD', 'RZ_E2E_ADMINISTRATOR_PASSWORD'
];
test.skip(required.some((name) => !process.env[name]), 'Standard packaged E2E environment is unavailable.');

test('standard packaged template smoke persists across restart', async () => {
  test.setTimeout(120_000);
  const root = path.resolve(__dirname, '..', '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-e2e-'));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.appendFileSync(path.join(root, 'test-results', 'e2e-temp-paths.txt'), `${userData}\n`, 'utf8');
  const executablePath = path.resolve(process.env.RZ_E2E_EXECUTABLE_PATH!);
  const app = await electron.launch({ executablePath, env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel('账号')).toBeVisible();
    const source = fs.readFileSync(path.join(root, 'tools', 'standard-e2e-flow.source.js'), 'utf8');
    const run = new Function(source)() as () => Promise<void>;
    (globalThis as any).__standardE2eContext = { electron, initialApp: app, initialPage: page, userData, root, fs, path };
    await run();
    delete (globalThis as any).__standardE2eContext;
  } finally { await app.close().catch(() => undefined); }
});
