return async function runReferenceFlow() {
  const { electron, executablePath, initialApp, initialPage, userData, root, fs, path } = globalThis.__referenceE2eContext;
  const { spawnSync } = process.getBuiltinModule('node:child_process');
  const crypto = process.getBuiltinModule('node:crypto');
  const sha256 = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  const passwords = {
    dispatcher: process.env.RZ_E2E_DISPATCHER_PASSWORD,
    operator: process.env.RZ_E2E_OPERATOR_PASSWORD,
    reviewer: process.env.RZ_E2E_REVIEWER_PASSWORD,
    administrator: process.env.RZ_E2E_ADMINISTRATOR_PASSWORD
  };
  for (const [name, value] of Object.entries(passwords)) if (!value) throw new Error(`${name} password is required.`);
  const unwrap = (value) => { if (!value.ok) throw new Error(JSON.stringify(value.error)); return value.data; };
  const invoke = (page, method, args) => page.evaluate(async ([name, values]) => {
    if (name === 'login') return window.businessApi.session.login(values[0], values[1]);
    if (name === 'domain') return window.businessApi.domain.execute(values[0], values[1], values[2]);
    if (name === 'create') return window.businessApi.entities.create(values[0], values[1], values[2]);
    if (name === 'list') return window.businessApi.entities.list(values[0], values[1], values[2]);
    throw new Error('Unknown browser API call.');
  }, [method, args]);
  const login = async (page, user, password) => unwrap(await invoke(page, 'login', [user, password]));
  const command = async (page, token, id, payload) => unwrap(await invoke(page, 'domain', [token, id, payload]));
  const showInactiveAsset = async (page) => {
    await page.getByLabel('账号').fill('administrator');
    await page.getByLabel('密码').fill(passwords.administrator);
    await page.getByRole('button', { name: '登录' }).click();
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
    await page.getByRole('button', { name: '资产台账', exact: true }).click();
    await page.getByPlaceholder('搜索记录').fill('AST-E2E-001');
    const row = page.getByRole('row').filter({ hasText: 'AST-E2E-001' });
    await row.waitFor();
    if (!String(await row.textContent()).includes('inactive')) throw new Error('Inactive asset is not visible.');
  };
  const deactivateAssetInUi = async (page) => {
    await page.getByLabel('账号').fill('administrator');
    await page.getByLabel('密码').fill(passwords.administrator);
    await page.getByRole('button', { name: '登录' }).click();
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
    await page.getByRole('button', { name: '资产台账', exact: true }).click();
    await page.getByPlaceholder('搜索记录').fill('AST-E2E-001');
    await page.getByRole('button', { name: '查看 AST-E2E-001' }).click();
    await page.getByRole('button', { name: '变更状态' }).click();
    await page.getByLabel('目标状态').selectOption('inactive');
    await page.getByLabel('变更原因').fill('验收闭环完成');
    await page.getByRole('button', { name: '确认' }).click();
    await page.getByRole('complementary', { name: '记录详情' }).getByText('inactive', { exact: true }).waitFor();
  };
  let app = initialApp;
  try {
    let page = initialPage;
    const admin = await login(page, 'administrator', passwords.administrator);
    const dispatcher = await login(page, 'dispatcher', passwords.dispatcher);
    const operator = await login(page, 'operator', passwords.operator);
    const reviewer = await login(page, 'reviewer', passwords.reviewer);
    const roles = [dispatcher.actor.roleId, operator.actor.roleId, reviewer.actor.roleId];
    if (roles.join(',') !== 'operations_dispatcher,operations_operator,operations_reviewer') throw new Error(`Unexpected roles: ${roles.join(',')}`);

    const asset = unwrap(await invoke(page, 'create', [admin.token, 'asset', {
      code: 'AST-E2E-001', name: 'E2E 空压机', category_code: 'CAT-001', status: 'active', location: '验收区域'
    }]));
    const denied = await invoke(page, 'domain', [operator.token, 'asset.change_status', {
      assetId: asset.id, expectedVersion: asset.version, nextStatus: 'inactive', reason: '越权操作'
    }]);
    if (denied.ok || denied.error.code !== 'PERMISSION_DENIED') throw new Error('Operator status change was not denied.');

    const plan = await command(page, dispatcher.token, 'asset.inspection.plan.create', {
      assetId: asset.id, name: 'E2E 巡检计划', cycleDays: 1, instructions: '执行完整验收巡检', active: true
    });
    const task = await command(page, dispatcher.token, 'asset.inspection.task.create', {
      planCode: plan.planCode, title: 'E2E 巡检任务', executorId: 'operator',
      scheduledAt: '2026-09-21T08:00:00.000Z', items: [{ name: 'E2E 温度检查', standard: '温度正常' }]
    });
    const blockedAsset = await invoke(page, 'domain', [admin.token, 'asset.change_status', {
      assetId: asset.id, expectedVersion: asset.version, nextStatus: 'inactive', reason: '未闭环停用'
    }]);
    if (blockedAsset.ok || blockedAsset.error.code !== 'INVALID_TRANSITION') throw new Error('Open inspection did not block asset deactivation.');
    const started = await command(page, operator.token, 'inspection.start', { taskId: task.taskId, expectedTaskVersion: task.version });
    const recordPayload = {
      taskId: task.taskId, itemId: task.itemIds[0], expectedTaskVersion: started.version, expectedItemVersion: 1,
      result: 'abnormal', finding: '运行温度超过阈值', disposition: '自动创建整改工单'
    };
    const recorded = await command(page, operator.token, 'inspection.record', recordPayload);
    const duplicate = await invoke(page, 'domain', [operator.token, 'inspection.record', recordPayload]);
    if (duplicate.ok) throw new Error('Duplicate abnormal result was accepted.');
    const submitted = await command(page, operator.token, 'inspection.submit', { taskId: task.taskId, expectedTaskVersion: recorded.taskVersion });
    const orders = unwrap(await invoke(page, 'list', [dispatcher.token, 'work_order', { page: 1, pageSize: 20, keyword: '巡检异常' }])).items;
    if (orders.length !== 1) throw new Error(`Expected one rectification work order, received ${orders.length}.`);
    const work = orders[0];
    const dispatched = await command(page, dispatcher.token, 'work_order.dispatch', { workOrderId: work.id, expectedVersion: work.version, handlerId: 'operator', reason: '执行整改' });
    const accepted = await command(page, operator.token, 'work_order.accept', { workOrderId: work.id, expectedVersion: dispatched.version });
    const processed = await command(page, operator.token, 'work_order.add_processing_record', { workOrderId: work.id, expectedVersion: accepted.version, content: '完成温控组件调整' });
    const resolved = await command(page, operator.token, 'work_order.submit_resolution', { workOrderId: work.id, expectedVersion: processed.version, resolution: '复测温度正常' });
    const early = await invoke(page, 'domain', [reviewer.token, 'inspection.archive', { taskId: task.taskId, expectedTaskVersion: submitted.version, comment: '提前归档' }]);
    if (early.ok || early.error.code !== 'INVALID_TRANSITION') throw new Error('Open work order did not block inspection archive.');
    await command(page, reviewer.token, 'work_order.approve_close', { workOrderId: work.id, expectedVersion: resolved.version, comment: '整改验证通过' });
    await command(page, reviewer.token, 'inspection.archive', { taskId: task.taskId, expectedTaskVersion: submitted.version, comment: '整改已关闭' });
    await deactivateAssetInUi(page);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results', 'reference-closed.png'), fullPage: true });
    await app.close();
    app = undefined;

    const check = spawnSync(process.execPath, ['-e', "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});const id=Number(process.argv[2]),code=process.argv[3];if(d.prepare(\"SELECT status FROM biz_asset WHERE code='AST-E2E-001'\").get().status!=='inactive'||d.prepare(\"SELECT status FROM biz_inspection_task WHERE title='E2E 巡检任务'\").get().status!=='archived'||d.prepare('SELECT status FROM biz_work_order WHERE id=?').get(id).status!=='closed'||d.prepare('SELECT COUNT(*) count FROM biz_inspection_work_order_link WHERE work_order_code=?').get(code).count!==1||d.prepare('SELECT COUNT(*) count FROM sys_audit_event').get().count<10)process.exit(1);d.close()", path.join(userData, 'runtime.sqlite'), String(work.id), String(work.values.code)], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'SQLite persistence check failed.');

    app = await electron.launch(executablePath
      ? { executablePath: path.resolve(executablePath), env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } }
      : { args: [root], env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
    page = await app.firstWindow();
    await showInactiveAsset(page);
    await app.close();
    app = undefined;
    fs.writeFileSync(path.join(root, 'test-results', 'reference-acceptance-status.json'), JSON.stringify({
      status: 'passed', restartPersistence: true,
      executableSha256: sha256(executablePath),
      resourceManifestSha256: sha256(path.join(path.dirname(executablePath), 'resources', 'runtime-resources', 'resource-manifest.json'))
    }), 'utf8');
  } finally {
    if (app) await app.close().catch(() => undefined);
  }
};
