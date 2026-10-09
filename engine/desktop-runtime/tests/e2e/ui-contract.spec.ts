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
            }],
            domainActions: [{ id: 'asset.change_status', label: '状态操作', entityId: 'asset', order: 10, scope: 'record' }]
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
        domain: {
          execute: (_token: string, commandId: string, payload: unknown) => {
            (window as typeof window & { __domainAction?: unknown }).__domainAction = { commandId, payload };
            return success({});
          }
        },
        dashboard: {
          read: () => {
            const target = window as typeof window & { __dashboardMode?: string; __dashboardCalls?: number };
            target.__dashboardCalls = (target.__dashboardCalls ?? 0) + 1;
            if (target.__dashboardMode === 'error') {
              return Promise.resolve({ ok: false, error: { code: 'INTERNAL_ERROR', message: '暂时不可用' } });
            }
            const empty = target.__dashboardMode === 'empty';
            return success({
              metrics: [
                { id: 'assets', name: '纳管资产', value: 120, tone: 'teal' },
                { id: 'tasks', name: '待办任务', value: 18, tone: 'amber' },
                { id: 'alerts', name: '未恢复异常', value: 7, tone: 'red' }
              ],
              sections: [{
                id: 'asset_dashboard', label: '资产运行情况', order: 10,
                groups: [
                  {
                    id: 'asset_status', label: '状态分布', kind: 'status',
                    items: [
                      { id: 'active', label: '正常运行', value: 80, tone: 'teal', moduleId: 'assets' },
                      { id: 'inactive', label: '暂停使用', value: 40, tone: 'neutral', moduleId: 'assets' }
                    ]
                  },
                  {
                    id: 'asset_attention', label: '需要关注', kind: 'attention',
                    items: [
                      { id: 'overdue', label: '超过计划完成时间且仍未处理的巡检任务', value: empty ? 0 : 4, tone: 'red', moduleId: 'tasks' },
                      { id: 'pending_review', label: '待复核任务', value: empty ? 0 : 2, tone: 'amber', moduleId: 'tasks' }
                    ]
                  }
                ]
              }]
            });
          }
        },
        maintenance: {
          backup: () => success({}), inspectRestore: () => success({}), restore: () => success({})
        }
      }
    });
  });
}

test('executes an authorized domain action from record detail', async ({ page }) => {
  await installApi(page);
  await page.goto('/');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill('Secret123!');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('button', { name: '资产台账', exact: true }).click();
  await page.getByRole('button', { name: '查看 AST-001' }).click();
  await page.getByRole('button', { name: '变更状态' }).click();
  await page.getByLabel('目标状态').selectOption('inactive');
  await page.getByLabel('变更原因').fill('验收停用');
  await page.getByRole('button', { name: '确认' }).click();
  expect(await page.evaluate(() => (window as typeof window & { __domainAction?: unknown }).__domainAction)).toEqual({
    commandId: 'asset.change_status',
    payload: { assetId: 1, expectedVersion: 1, nextStatus: 'inactive', reason: '验收停用' }
  });
});

test('creates a record through the metadata form', async ({ page }) => {
  await installApi(page);
  await page.goto('/');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill('Secret123!');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('button', { name: '资产台账', exact: true }).click();
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
    await expect(page.getByRole('region', { name: '核心指标' })).toBeVisible();
    await expect(page.getByRole('region', { name: '状态概览' })).toBeVisible();
    await expect(page.getByRole('region', { name: '待办工作' }).getByText('待复核任务')).toBeVisible();
    await expect(page.getByRole('region', { name: '业务入口' })).toBeVisible();
    await expect(page.getByText('没有需要立即处理的业务事项。')).toHaveCount(0);
    await expect(page.locator('[data-state="loading"]')).toHaveCount(0);

    const clipped = await page.locator('.dashboard-workspace').evaluate((root) => {
      const elements = [...root.querySelectorAll<HTMLElement>('*')];
      return elements.some((element) => element.scrollWidth > element.clientWidth + 1 &&
        getComputedStyle(element).overflowX === 'visible');
    });
    expect(clipped).toBe(false);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `test-results/ui-${viewport.name}.png`, fullPage: true });
  });
}

test('supports dashboard navigation, empty data, failure, and retry', async ({ page }) => {
  await installApi(page);
  await page.goto('/');
  await page.getByLabel('账号').fill('admin');
  await page.getByLabel('密码').fill('Secret123!');
  await page.getByRole('button', { name: '登录' }).click();

  await page.getByRole('button', { name: '查看任务协同' }).first().click();
  await expect(page.getByRole('heading', { name: '任务协同' })).toBeVisible();
  await page.getByRole('button', { name: '运维总览' }).click();

  await page.evaluate(() => { (window as typeof window & { __dashboardMode?: string }).__dashboardMode = 'empty'; });
  await page.getByRole('button', { name: '刷新仪表盘' }).click();
  await expect(page.getByText('没有需要立即处理的业务事项。')).toBeVisible();

  await page.evaluate(() => { (window as typeof window & { __dashboardMode?: string }).__dashboardMode = 'error'; });
  await page.getByRole('button', { name: '刷新仪表盘' }).click();
  await expect(page.getByRole('alert')).toContainText('仪表盘加载失败');
  await page.evaluate(() => { (window as typeof window & { __dashboardMode?: string }).__dashboardMode = 'ready'; });
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByRole('region', { name: '待办工作' }).getByText('待复核任务')).toBeVisible();
});
