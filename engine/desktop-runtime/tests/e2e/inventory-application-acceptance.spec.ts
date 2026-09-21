import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const required = ['RZ_E2E_EXECUTABLE_PATH', 'RZ_E2E_DISPATCHER_PASSWORD', 'RZ_E2E_REVIEWER_PASSWORD'];
test.skip(process.env.RZ_E2E_TEMPLATE_ID !== 'inventory_application_approval' || required.some((name) => !process.env[name]), 'Inventory application package is unavailable.');

test('approved inventory application deducts one batch exactly once', async () => {
  test.setTimeout(120_000);
  const root = path.resolve(__dirname, '..', '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-e2e-'));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.appendFileSync(path.join(root, 'test-results', 'e2e-temp-paths.txt'), `${userData}\n`, 'utf8');
  const app = await electron.launch({ executablePath: path.resolve(process.env.RZ_E2E_EXECUTABLE_PATH!), env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel('账号')).toBeVisible();
    const source = fs.readFileSync(path.join(root, 'tools', 'inventory-application-e2e.source.js'), 'utf8');
    const run = new Function(source)() as () => Promise<void>;
    (globalThis as any).__inventoryE2eContext = { initialApp: app, initialPage: page, userData, fs, path };
    await run();
    delete (globalThis as any).__inventoryE2eContext;
  } finally { await app.close().catch(() => undefined); }
});
