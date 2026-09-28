import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const supported = new Set(['project_task_management', 'project_delivery_archive']);
const required = ['RZ_E2E_EXECUTABLE_PATH', 'RZ_E2E_DISPATCHER_PASSWORD'];
test.skip(!supported.has(process.env.RZ_E2E_TEMPLATE_ID ?? '') || required.some((name) => !process.env[name]), 'Packaged project action environment is unavailable.');

test('creates and activates a project through the packaged UI and persists restart', async () => {
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
    const source = fs.readFileSync(path.join(root, 'tools', 'project-actions-e2e.source.js'), 'utf8');
    const run = new Function(source)() as () => Promise<void>;
    (globalThis as any).__projectActionsE2eContext = { electron, initialApp: app, initialPage: page, userData, executablePath, fs, path };
    await run();
    delete (globalThis as any).__projectActionsE2eContext;
  } finally { await app.close().catch(() => undefined); }
});
