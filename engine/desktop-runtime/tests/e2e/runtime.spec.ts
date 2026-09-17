import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runtimeRoot = path.resolve(__dirname, '..', '..');
const taskCode = 'TASK-030';

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('账号').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

async function openFirstTask(page: Page): Promise<void> {
  await page.getByRole('button', { name: '任务协同' }).click();
  await expect(page.getByText(taskCode)).toBeVisible();
  await page.getByRole('button', { name: `查看 ${taskCode}` }).click();
}

async function expectDetailStatus(page: Page, status: string): Promise<void> {
  await expect(
    page.getByRole('complementary', { name: '记录详情' }).getByText(status, { exact: true })
  ).toBeVisible();
}

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [runtimeRoot],
    env: { ...process.env, RZ_RUNTIME_USER_DATA: userData }
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => console.error(`PAGE_ERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`PAGE_CONSOLE: ${message.text()}`);
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  page.on('dialog', (dialog) => void dialog.accept());
  await expect(page.getByLabel('账号')).toBeVisible({ timeout: 5_000 });
  return { app, page };
}

async function closeApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();
  const exited = child.exitCode === null ? once(child, 'exit') : Promise.resolve();
  await application.close();
  await exited;
}

test.beforeAll(() => {
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'];
  const result = spawnSync(executable, args, {
    cwd: runtimeRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
});

test('three roles complete a workflow and preserve it across restart', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-e2e-'));
  try {
    let running = await launch(userData);
    await login(running.page, 'dispatcher', 'Dispatch123!');
    await openFirstTask(running.page);
    await running.page.getByRole('button', { name: '分派任务' }).click();
    await expectDetailStatus(running.page, 'assigned');
    await running.page.getByRole('button', { name: '退出登录' }).click();

    await login(running.page, 'operator', 'Operator123!');
    await openFirstTask(running.page);
    await running.page.getByRole('button', { name: '接受任务' }).click();
    await running.page.getByRole('button', { name: '提交处理' }).click();
    await expectDetailStatus(running.page, 'review');
    await running.page.getByRole('button', { name: '退出登录' }).click();

    await login(running.page, 'reviewer', 'Review123!');
    await openFirstTask(running.page);
    await running.page.getByRole('button', { name: '复核关闭' }).click();
    await expectDetailStatus(running.page, 'closed');
    await running.page.screenshot({ path: 'test-results/runtime-closed.png', fullPage: true });
    await closeApplication(running.app);

    const database = new DatabaseSync(path.join(userData, 'runtime.sqlite'), { readOnly: true });
    try {
      const task = database.prepare('SELECT status FROM biz_task WHERE code = ?').get(taskCode) as { status: string };
      const events = database.prepare('SELECT COUNT(*) AS count FROM sys_workflow_event').get() as { count: number };
      const audits = database.prepare('SELECT COUNT(*) AS count FROM sys_audit_event').get() as { count: number };
      assert.equal(task.status, 'closed');
      assert.equal(events.count, 4);
      assert.equal(audits.count, 4);
    } finally {
      database.close();
    }

    running = await launch(userData);
    await login(running.page, 'reviewer', 'Review123!');
    await openFirstTask(running.page);
    await expectDetailStatus(running.page, 'closed');
    await closeApplication(running.app);
  } finally {
    fs.mkdirSync(path.join(runtimeRoot, 'test-results'), { recursive: true });
    fs.appendFileSync(
      path.join(runtimeRoot, 'test-results', 'e2e-temp-paths.txt'),
      `${userData}\n`,
      'utf8'
    );
  }
});
