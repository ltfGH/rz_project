return async function runProjectActionsFlow() {
  const { electron, initialApp, initialPage, userData, executablePath } = globalThis.__projectActionsE2eContext;
  const password = process.env.RZ_E2E_DISPATCHER_PASSWORD;
  const uniqueName = `E2E 分发项目 ${Date.now()}`;
  const unwrap = (value) => { if (!value.ok) throw new Error(JSON.stringify(value.error)); return value.data; };
  const loginApi = (page) => page.evaluate(async ([username, secret]) => window.businessApi.session.login(username, secret), ['dispatcher', password]).then(unwrap);
  const metadata = (page, token) => page.evaluate((value) => window.businessApi.metadata.read(value), token).then(unwrap);
  const uiLogin = async (page) => {
    await page.getByLabel('账号').fill('dispatcher');
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
  };
  const projectModuleName = async (page) => {
    const session = await loginApi(page);
    const data = await metadata(page, session.token);
    const module = data.modules.find((entry) => entry.id === 'projects');
    if (!module) throw new Error('Projects module is unavailable.');
    return { name: module.name, token: session.token };
  };
  let app = initialApp;
  try {
    let page = initialPage;
    await uiLogin(page);
    let module = await projectModuleName(page);
    await page.getByRole('button', { name: module.name, exact: true }).click();
    const moduleActions = page.getByRole('region', { name: '模块操作' });
    await moduleActions.getByRole('button', { name: '创建项目', exact: true }).click();
    await moduleActions.getByLabel('项目名称').fill(uniqueName);
    await moduleActions.getByLabel('项目经理账号').fill('dispatcher');
    await moduleActions.getByLabel('计划开始日期').fill('2026-10-01');
    await moduleActions.getByLabel('计划结束日期').fill('2026-12-31');
    await moduleActions.getByRole('button', { name: '确认', exact: true }).click();
    await page.getByPlaceholder('搜索记录').fill(uniqueName);
    const row = page.getByRole('row').filter({ hasText: uniqueName });
    await row.waitFor();
    const listed = unwrap(await page.evaluate(async ([token, keyword]) => window.businessApi.entities.list(token, 'project', { page: 1, pageSize: 20, keyword }), [module.token, uniqueName]));
    if (listed.total !== 1) throw new Error(`Expected one created project, received ${listed.total}.`);
    await row.getByRole('button', { name: /^查看 / }).click();
    const detail = page.getByRole('complementary', { name: '记录详情' });
    const actions = detail.getByRole('region', { name: '领域操作' });
    await actions.getByRole('button', { name: '激活项目', exact: true }).click();
    await actions.getByRole('button', { name: '确认', exact: true }).click();
    await detail.getByText('active', { exact: true }).waitFor();
    await app.close(); app = undefined;

    app = await electron.launch({ executablePath, env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
    page = await app.firstWindow();
    await uiLogin(page);
    module = await projectModuleName(page);
    await page.getByRole('button', { name: module.name, exact: true }).click();
    await page.getByPlaceholder('搜索记录').fill(uniqueName);
    const restartedRow = page.getByRole('row').filter({ hasText: uniqueName });
    await restartedRow.waitFor();
    if (!String(await restartedRow.textContent()).includes('active')) throw new Error('Activated project did not persist after restart.');
    await app.close(); app = undefined;
  } finally { if (app) await app.close().catch(() => undefined); }
};
