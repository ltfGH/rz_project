import { test, expect, type Page } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';

let server: PreviewServer;

test.beforeAll(async () => {
  await build({ configFile: 'vite.config.mts' });
  server = await preview({
    configFile: 'vite.config.mts',
    preview: { host: '127.0.0.1', port: 4173, strictPort: true }
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.httpServer.close((error) => error ? reject(error) : resolve());
  });
});

async function installApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const success = (data: unknown) => Promise.resolve({ ok: true, data });
    Object.defineProperty(window, 'businessApi', {
      configurable: false,
      value: {
        session: {
          login: () => success({
            token: 'test-token',
            actor: { userId: 1, username: 'admin', displayName: '系统管理员', roleId: 'admin' },
            expiresAt: '2026-09-17T00:00:00.000Z'
          }),
          logout: () => success(null),
          current: () => success({ userId: 1, username: 'admin', displayName: '系统管理员', roleId: 'admin' })
        },
        metadata: {
          read: () => success({
            software: { name: '企业资产协同管理软件' },
            modules: [
              { id: 'assets', name: '资产台账', route: 'assets', entity: 'asset', actions: ['list', 'create', 'view'] },
              { id: 'tasks', name: '任务协同', route: 'tasks', entity: 'task', actions: ['list', 'view'] }
            ],
            entities: [{
              id: 'asset', name: '资产', retention: 'protected', history: false, systemManaged: false,
              fields: [
                { id: 'code', name: '资产编码', type: 'text', required: true, unique: true },
                { id: 'name', name: '资产名称', type: 'text', required: true, unique: false },
                { id: 'status', name: '状态', type: 'enum', required: true, unique: false, options: ['active', 'inactive'] }
              ], relations: []
            }]
          })
        },
        entities: {
          list: () => success({
            items: [{ id: 1, version: 1, values: { code: 'AST-001', name: '核心应用节点', status: 'active' } }],
            page: 1, pageSize: 20, total: 1
          }),
          get: () => success({ id: 1, version: 1, values: { code: 'AST-001', name: '核心应用节点', status: 'active' } }),
          create: (_token: string, _entity: string, values: unknown) => {
            (window as typeof window & { __created?: unknown }).__created = values;
            return success({ id: 2, version: 1, values });
          },
          update: () => success({})
        },
        workflows: { allowed: () => success([]), execute: () => success({}) },
        dashboard: {
          read: () => success([
            { id: 'assets', name: '纳管资产', value: 120, tone: 'teal' },
            { id: 'tasks', name: '待办任务', value: 18, tone: 'amber' },
            { id: 'alerts', name: '未恢复异常', value: 7, tone: 'red' }
          ])
        },
        maintenance: {
          backup: () => success({}), inspectRestore: () => success({}), restore: () => success({})
        }
      }
    });
  });
}

test('creates a record through the metadata form', async ({ page }) => {
  await installApi(page);
  await page.goto('/');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill('Secret123!');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('button', { name: '新增' }).click();
  await expect(page.getByRole('complementary', { name: '记录编辑' })).toBeVisible();
  await page.getByLabel('资产编码').fill('AST-002');
  await page.getByLabel('资产名称').fill('备用节点');
  await page.getByLabel('状态').selectOption('active');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('complementary', { name: '记录编辑' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __created?: unknown }).__created)).toEqual({
    code: 'AST-002', name: '备用节点', status: 'active'
  });
});

for (const viewport of [
  { name: 'standard', width: 1366, height: 768 },
  { name: 'minimum', width: 1100, height: 760 }
]) {
  test(`renders stable business UI at ${viewport.name} desktop size`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installApi(page);
    await page.goto('/');
    await page.getByLabel('账号').fill('admin');
    await page.getByLabel('密码').fill('Secret123!');
    await page.getByRole('button', { name: '登录' }).click();

    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '企业资产协同管理软件' })).toBeVisible();
    await expect(page.getByText('系统管理员')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.locator('[data-ui="list-toolbar"]')).toBeVisible();
    await expect(page.locator('[data-ui="pagination"]')).toBeVisible();
    await expect(page.locator('[data-state="loading"]')).toHaveCount(0);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `test-results/ui-${viewport.name}.png`, fullPage: true });
  });
}
