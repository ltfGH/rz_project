return async function runInventoryApplicationFlow() {
  const { initialApp, initialPage, userData, path, capture } = globalThis.__inventoryE2eContext;
  const { spawnSync } = process.getBuiltinModule('node:child_process');
  const unwrap = (value) => { if (!value.ok) throw new Error(JSON.stringify(value.error)); return value.data; };
  const invoke = (page, method, args) => page.evaluate(async ([name, values]) => {
    if (name === 'login') return window.businessApi.session.login(values[0], values[1]);
    if (name === 'domain') return window.businessApi.domain.execute(values[0], values[1], values[2]);
    if (name === 'list') return window.businessApi.entities.list(values[0], values[1], values[2]);
    if (name === 'get') return window.businessApi.entities.get(values[0], values[1], values[2]);
    if (name === 'metadata') return window.businessApi.metadata.read(values[0]);
    throw new Error('Unknown API method.');
  }, [method, args]);
  let app = initialApp;
  try {
    const page = initialPage;
    const uiLogin=async(username,password)=>{await page.getByLabel('账号').fill(username);await page.getByLabel('密码').fill(password);await page.getByRole('button',{name:'登录'}).click();await page.getByRole('navigation',{name:'主导航'}).waitFor();};
    const uiLogout=async()=>{const button=page.getByRole('button',{name:'退出登录'});if(await button.count())await button.click();await page.getByLabel('账号').waitFor();};
    const moduleName=async(token,id)=>{const metadata=unwrap(await invoke(page,'metadata',[token]));const module=metadata.modules.find((entry)=>entry.id===id);if(!module)throw new Error(`Module '${id}' is unavailable.`);return module.name;};
    const dispatcher = unwrap(await invoke(page, 'login', ['dispatcher', process.env.RZ_E2E_DISPATCHER_PASSWORD]));
    const reviewer = unwrap(await invoke(page, 'login', ['reviewer', process.env.RZ_E2E_REVIEWER_PASSWORD]));
    const batches = unwrap(await invoke(page, 'list', [dispatcher.token, 'inventory_batch', { page: 1, pageSize: 5 }])).items;
    if (!batches.length) throw new Error('No inventory batch is available.');
    const batch = batches[0];
    const before = Number(batch.values.quantity);
    await uiLogin('dispatcher',process.env.RZ_E2E_DISPATCHER_PASSWORD);
    await page.getByRole('button',{name:await moduleName(dispatcher.token,'inventory_batches'),exact:true}).click();
    await page.getByPlaceholder('搜索记录').fill(String(batch.values.code));
    await page.getByRole('button',{name:new RegExp(`^查看 ${String(batch.values.code).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`)}).click();
    const batchDetail=page.getByRole('complementary',{name:'记录详情'}),batchActions=batchDetail.getByRole('region',{name:'领域操作'});
    await batchActions.getByRole('button',{name:'发起库存申领',exact:true}).click();
    await batchActions.getByLabel('申领数量').fill('3');await batchActions.getByLabel('申领用途').fill('E2E maintenance issue');await batchActions.getByLabel('申请标题').fill('E2E inventory application');await batchActions.getByLabel('申请正文').fill('Issue three units for verified maintenance.');
    await capture(page,{scenarioId:'application_create_form',workflowStepId:'application',roleId:'operations_dispatcher',moduleId:'inventory_batches',actionId:'inventory.application.create',controlLabel:'发起库存申领',stateBefore:'尚未提交库存申领',stateAfter:'库存申领表单已完整填写'});
    await batchActions.getByRole('button',{name:'取消',exact:true}).click();
    const application = unwrap(await invoke(page, 'domain', [dispatcher.token, 'inventory.application.create', {
      batchCode: batch.values.code, quantity: 3, purpose: 'E2E maintenance issue', title: 'E2E inventory application', content: 'Issue three units for verified maintenance.'
    }]));
    await page.getByRole('button',{name:'关闭详情',exact:true}).click();await page.getByRole('button',{name:await moduleName(dispatcher.token,'applications'),exact:true}).click();await page.getByPlaceholder('搜索记录').fill('E2E inventory application');await page.getByRole('row').filter({hasText:'E2E inventory application'}).waitFor();
    await capture(page,{scenarioId:'application_draft',workflowStepId:null,roleId:'operations_dispatcher',moduleId:'applications',actionId:null,stateBefore:'申领申请尚未建立',stateAfter:'申请列表显示库存申领草稿',controlVerified:false});
    const submitted = unwrap(await invoke(page, 'domain', [dispatcher.token, 'application.submit', {
      applicationId: application.applicationId, expectedVersion: application.version, comment: 'Submit E2E issue'
    }]));
    const nodes = unwrap(await invoke(page, 'list', [reviewer.token, 'approval_node', {
      page: 1, pageSize: 10, filters: [{ field: 'application_code', operator: 'eq', value: application.applicationCode }]
    }])).items;
    const node = nodes.find((entry) => entry.values.status === 'active');
    if (!node) throw new Error('Active approval node was not found.');
    await uiLogout();await uiLogin('reviewer',process.env.RZ_E2E_REVIEWER_PASSWORD);await page.getByRole('button',{name:await moduleName(reviewer.token,'applications'),exact:true}).click();await page.getByPlaceholder('搜索记录').fill('E2E inventory application');await page.getByRole('row').filter({hasText:'E2E inventory application'}).getByRole('button',{name:/^查看 /}).click();
    const applicationActions=page.getByRole('complementary',{name:'记录详情'}).getByRole('region',{name:'领域操作'});await applicationActions.getByRole('button',{name:'批准当前节点',exact:true}).click();await applicationActions.getByLabel('审批节点 ID').fill(String(node.id));await applicationActions.getByLabel('节点版本').fill(String(node.version));await applicationActions.getByLabel('审批意见').fill('Approve E2E issue');
    await capture(page,{scenarioId:'application_review',workflowStepId:'approve',roleId:'operations_reviewer',moduleId:'applications',actionId:'application.approve',controlLabel:'批准当前节点',stateBefore:'库存申领处于审批中',stateAfter:'审批表单已填写批准意见'});await applicationActions.getByRole('button',{name:'取消',exact:true}).click();
    const approved = unwrap(await invoke(page, 'domain', [reviewer.token, 'application.approve', {
      applicationId: application.applicationId, expectedApplicationVersion: submitted.version,
      nodeId: node.id, expectedNodeVersion: node.version, comment: 'Approve E2E issue'
    }]));
    if (approved.status !== 'approved') throw new Error('Application was not approved.');
    const updated = unwrap(await invoke(page, 'get', [reviewer.token, 'inventory_batch', batch.id]));
    if (Number(updated.values.quantity) !== before - 3) throw new Error('Inventory quantity was not deducted exactly once.');
    await page.getByRole('button',{name:'关闭详情',exact:true}).click();await page.getByRole('button',{name:await moduleName(reviewer.token,'inventory_batches'),exact:true}).click();await page.getByPlaceholder('搜索记录').fill(String(batch.values.code));await page.getByRole('row').filter({hasText:String(batch.values.code)}).waitFor();
    await capture(page,{scenarioId:'batch_deducted',workflowStepId:'deduct',roleId:'operations_reviewer',moduleId:'inventory_batches',actionId:null,stateBefore:`批次库存为 ${before}`,stateAfter:`审批后批次库存为 ${before-3}`,controlVerified:false});
    const duplicate = await invoke(page, 'domain', [reviewer.token, 'application.approve', {
      applicationId: application.applicationId, expectedApplicationVersion: submitted.version,
      nodeId: node.id, expectedNodeVersion: node.version, comment: 'Duplicate approval'
    }]);
    if (duplicate.ok) throw new Error('Duplicate approval unexpectedly succeeded.');
    const afterDuplicate = unwrap(await invoke(page, 'get', [reviewer.token, 'inventory_batch', batch.id]));
    if (Number(afterDuplicate.values.quantity) !== before - 3) throw new Error('Duplicate approval changed inventory.');
    await app.close(); app = undefined;
    const check = spawnSync(process.execPath, ['-e', "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});const a=d.prepare(\"SELECT COUNT(*) count FROM biz_application_inventory_issue WHERE application_code=?\").get(process.argv[2]).count,q=Number(d.prepare(\"SELECT quantity FROM biz_inventory_batch WHERE code=?\").get(process.argv[3]).quantity);d.close();if(a!==1||q!==Number(process.argv[4]))process.exit(1);", path.join(userData, 'runtime.sqlite'), application.applicationCode, String(batch.values.code), String(before - 3)], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'Inventory application SQLite check failed.');
  } finally { if (app) await app.close().catch(() => undefined); }
};
