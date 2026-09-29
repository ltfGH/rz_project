return async function runProjectActionsFlow() {
  const { electron, initialApp, initialPage, userData, executablePath, capture } = globalThis.__projectActionsE2eContext;
  const password = process.env.RZ_E2E_DISPATCHER_PASSWORD;
  const projectWorkflowStep = process.env.RZ_E2E_TEMPLATE_ID === 'project_delivery_archive' ? 'project_task' : 'project';
  const uniqueName = `E2E 分发项目 ${Date.now()}`;
  const unwrap = (value) => { if (!value.ok) throw new Error(JSON.stringify(value.error)); return value.data; };
  const invoke=(page,name,args)=>page.evaluate(async([method,values])=>{if(method==='login')return window.businessApi.session.login(values[0],values[1]);if(method==='domain')return window.businessApi.domain.execute(values[0],values[1],values[2]);if(method==='list')return window.businessApi.entities.list(values[0],values[1],values[2]);if(method==='get')return window.businessApi.entities.get(values[0],values[1],values[2]);if(method==='metadata')return window.businessApi.metadata.read(values[0]);throw new Error('Unknown API method.');},[name,args]);
  const loginApi = (page,username='dispatcher',secret=password) => invoke(page,'login',[username,secret]).then(unwrap);
  const metadata = (page, token) => page.evaluate((value) => window.businessApi.metadata.read(value), token).then(unwrap);
  let uiRole;
  const uiLogin = async (page,username='dispatcher',secret=password) => {
    await page.getByLabel('账号').fill(username);
    await page.getByLabel('密码').fill(secret);
    await page.getByRole('button', { name: '登录' }).click();
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
    uiRole=username;
  };
  const switchUi=async(page,username,secret)=>{if(uiRole){await page.getByRole('button',{name:'退出登录'}).click();await page.getByLabel('账号').waitFor();}await uiLogin(page,username,secret);};
  const moduleName=async(page,token,id)=>{const data=unwrap(await invoke(page,'metadata',[token]));const module=data.modules.find((entry)=>entry.id===id);if(!module)throw new Error(`Module '${id}' is unavailable.`);return module.name;};
  const showRecord=async(page,token,moduleId,keyword)=>{const close=page.getByRole('button',{name:'关闭详情',exact:true});if(await close.count()&&await close.first().isVisible())await close.first().click();await page.getByRole('button',{name:await moduleName(page,token,moduleId),exact:true}).click();await page.getByPlaceholder('搜索记录').fill(keyword);const row=page.getByRole('row').filter({hasText:keyword});await row.waitFor();await row.getByRole('button',{name:/^查看 /}).click();await page.getByRole('complementary',{name:'记录详情'}).waitFor();};
  const domain=(page,token,id,input)=>invoke(page,'domain',[token,id,input]).then(unwrap);
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
    await capture(page,{scenarioId:'project_create_form',workflowStepId:projectWorkflowStep,roleId:'operations_dispatcher',moduleId:'projects',actionId:'project.create',controlLabel:'创建项目',stateBefore:'项目尚未创建',stateAfter:'创建项目表单已完整填写'});
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
    await capture(page,{scenarioId:'project_activate',workflowStepId:process.env.RZ_E2E_TEMPLATE_ID==='project_task_management'?'activate':null,roleId:'operations_dispatcher',moduleId:'projects',actionId:null,stateBefore:'项目处于草稿状态',stateAfter:'项目详情显示进行中状态',controlVerified:false});
    if(process.env.RZ_E2E_TEMPLATE_ID==='project_delivery_archive'){
      await actions.getByRole('button',{name:'创建任务',exact:true}).click();await actions.getByLabel('任务标题').fill('E2E 归档任务');await actions.getByLabel('任务说明').fill('准备交付归档材料');await actions.getByLabel('负责人账号').fill('operator');await actions.getByLabel('任务权重').fill('100');await capture(page,{scenarioId:'task_create_form',workflowStepId:null,roleId:'operations_dispatcher',moduleId:'projects',actionId:'project.task.create',controlLabel:'创建任务',stateBefore:'项目尚无归档任务',stateAfter:'归档任务表单已完整填写'});await actions.getByRole('button',{name:'取消',exact:true}).click();
      await actions.getByRole('button',{name:'提交交付成果',exact:true}).click();await actions.getByLabel('交付物键').fill('archive-package');await actions.getByLabel('交付物名称').fill('归档交付包');await actions.getByLabel('业务版本').fill('1.0');await actions.getByLabel('文件名称').fill('archive-package.zip');await actions.getByLabel('文件摘要').fill('sha256:e2e-archive-package');await capture(page,{scenarioId:'deliverable_submit_form',workflowStepId:'deliverable',roleId:'operations_dispatcher',moduleId:'projects',actionId:'project.deliverable.submit',controlLabel:'提交交付成果',stateBefore:'项目尚无归档交付版本',stateAfter:'交付成果表单已完整填写'});await actions.getByRole('button',{name:'取消',exact:true}).click();
      const archiveReviewer=await loginApi(page,'reviewer',process.env.RZ_E2E_REVIEWER_PASSWORD);await switchUi(page,'reviewer',process.env.RZ_E2E_REVIEWER_PASSWORD);await showRecord(page,archiveReviewer.token,'projects',uniqueName);const archiveActions=page.getByRole('complementary',{name:'记录详情'}).getByRole('region',{name:'领域操作'});await archiveActions.getByRole('button',{name:'归档交付物',exact:true}).click();await archiveActions.getByLabel('交付版本 ID').fill('1');await archiveActions.getByLabel('文件版本编码').fill('FILE-001');await capture(page,{scenarioId:'file_archive_form',workflowStepId:'file_archive',roleId:'operations_reviewer',moduleId:'projects',actionId:'project.delivery.archive',controlLabel:'归档交付物',stateBefore:'交付版本尚未关联归档文件',stateAfter:'归档关联表单已完整填写'});await archiveActions.getByRole('button',{name:'取消',exact:true}).click();
    }
    if(process.env.RZ_E2E_TEMPLATE_ID==='project_task_management'){
      const dispatcher=await loginApi(page),operator=await loginApi(page,'operator',process.env.RZ_E2E_OPERATOR_PASSWORD),reviewer=await loginApi(page,'reviewer',process.env.RZ_E2E_REVIEWER_PASSWORD);
      const project=(await invoke(page,'list',[dispatcher.token,'project',{page:1,pageSize:5,keyword:uniqueName}]).then(unwrap)).items[0];if(!project)throw new Error('Created project was not found.');
      await actions.getByRole('button',{name:'创建里程碑',exact:true}).click();await actions.getByLabel('里程碑名称').fill('E2E 交付节点');await actions.getByLabel('计划完成日期').fill('2026-11-30');
      await capture(page,{scenarioId:'milestone_create_form',workflowStepId:null,roleId:'operations_dispatcher',moduleId:'projects',actionId:'project.milestone.create',controlLabel:'创建里程碑',stateBefore:'项目尚无验收里程碑',stateAfter:'里程碑表单已完整填写'});await actions.getByRole('button',{name:'取消',exact:true}).click();
      const milestone=await domain(page,dispatcher.token,'project.milestone.create',{projectId:project.id,name:'E2E 交付节点',dueAt:'2026-11-30'});
      await actions.getByRole('button',{name:'创建任务',exact:true}).click();await actions.getByLabel('里程碑编码').fill(milestone.milestoneCode);await actions.getByLabel('任务标题').fill('E2E 分发任务');await actions.getByLabel('任务说明').fill('完成边缘分发验证');await actions.getByLabel('负责人账号').fill('operator');await actions.getByLabel('任务权重').fill('100');
      await capture(page,{scenarioId:'task_create_form',workflowStepId:'milestone_task',roleId:'operations_dispatcher',moduleId:'projects',actionId:'project.task.create',controlLabel:'创建任务',stateBefore:'项目尚无执行任务',stateAfter:'任务表单已完整填写'});await actions.getByRole('button',{name:'取消',exact:true}).click();
      let task=await domain(page,dispatcher.token,'project.task.create',{projectId:project.id,milestoneCode:milestone.milestoneCode,title:'E2E 分发任务',description:'完成边缘分发验证',assigneeId:'operator',weight:100,required:true});
      await switchUi(page,'operator',process.env.RZ_E2E_OPERATOR_PASSWORD);task=await domain(page,operator.token,'project.task.start',{taskId:task.taskId,expectedVersion:task.version});await showRecord(page,operator.token,'project_tasks','E2E 分发任务');
      await capture(page,{scenarioId:'task_start',workflowStepId:null,roleId:'operations_operator',moduleId:'project_tasks',actionId:null,stateBefore:'任务待开始',stateAfter:'任务详情显示执行中',controlVerified:true});
      task=await domain(page,operator.token,'project.task.progress',{taskId:task.taskId,expectedVersion:task.version,note:'边缘节点分发验证完成'});await showRecord(page,operator.token,'project_tasks','E2E 分发任务');await capture(page,{scenarioId:'task_progress',workflowStepId:null,roleId:'operations_operator',moduleId:'project_tasks',actionId:null,stateBefore:'任务尚无最新进展',stateAfter:'任务详情保留最新进展事件',controlVerified:true});
      task=await domain(page,operator.token,'project.task.submit',{taskId:task.taskId,expectedVersion:task.version});await showRecord(page,operator.token,'project_tasks','E2E 分发任务');await capture(page,{scenarioId:'task_submit',workflowStepId:null,roleId:'operations_operator',moduleId:'project_tasks',actionId:null,stateBefore:'任务执行中',stateAfter:'任务详情显示待验收',controlVerified:true});
      task=await domain(page,dispatcher.token,'project.task.approve',{taskId:task.taskId,expectedVersion:task.version,comment:'任务验收通过'});await switchUi(page,'dispatcher',password);await showRecord(page,dispatcher.token,'project_tasks','E2E 分发任务');await capture(page,{scenarioId:'task_review',workflowStepId:null,roleId:'operations_dispatcher',moduleId:'project_tasks',actionId:null,stateBefore:'任务待验收',stateAfter:'任务详情显示已完成',controlVerified:true});
      await showRecord(page,dispatcher.token,'projects',uniqueName);const projectActions=page.getByRole('complementary',{name:'记录详情'}).getByRole('region',{name:'领域操作'});await projectActions.getByRole('button',{name:'登记风险',exact:true}).click();await projectActions.getByLabel('风险标题').fill('E2E 分发风险');await projectActions.getByLabel('风险说明').fill('节点连接稳定性风险');await projectActions.getByLabel('风险等级').selectOption('high');await capture(page,{scenarioId:'risk_create_form',workflowStepId:'risk',roleId:'operations_dispatcher',moduleId:'projects',actionId:'project.risk.create',controlLabel:'登记风险',stateBefore:'项目尚无高风险记录',stateAfter:'高风险登记表单已完整填写'});await projectActions.getByRole('button',{name:'取消',exact:true}).click();
      let risk=await domain(page,dispatcher.token,'project.risk.create',{projectId:project.id,title:'E2E 分发风险',description:'节点连接稳定性风险',level:'high'});risk=await domain(page,dispatcher.token,'project.risk.mitigate',{riskId:risk.riskId,expectedVersion:risk.version,disposition:'完成链路复测'});risk=await domain(page,reviewer.token,'project.risk.close',{riskId:risk.riskId,expectedVersion:risk.version,comment:'风险关闭'});await switchUi(page,'reviewer',process.env.RZ_E2E_REVIEWER_PASSWORD);await showRecord(page,reviewer.token,'project_risks','E2E 分发风险');await capture(page,{scenarioId:'risk_process',workflowStepId:null,roleId:'operations_reviewer',moduleId:'project_risks',actionId:null,stateBefore:'风险待处置',stateAfter:'风险详情显示已关闭',controlVerified:true});
      await switchUi(page,'operator',process.env.RZ_E2E_OPERATOR_PASSWORD);await showRecord(page,operator.token,'projects',uniqueName);const deliverableActions=page.getByRole('complementary',{name:'记录详情'}).getByRole('region',{name:'领域操作'});await deliverableActions.getByRole('button',{name:'提交交付成果',exact:true}).click();await deliverableActions.getByLabel('里程碑编码').fill(milestone.milestoneCode);await deliverableActions.getByLabel('交付物键').fill('edge-package');await deliverableActions.getByLabel('交付物名称').fill('边缘分发包');await deliverableActions.getByLabel('业务版本').fill('1.0');await deliverableActions.getByLabel('文件名称').fill('edge-package.zip');await deliverableActions.getByLabel('文件摘要').fill('sha256:e2e-edge-package');await capture(page,{scenarioId:'deliverable_submit',workflowStepId:'deliverable',roleId:'operations_operator',moduleId:'projects',actionId:'project.deliverable.submit',controlLabel:'提交交付成果',stateBefore:'项目尚无交付版本',stateAfter:'交付成果表单已完整填写'});await deliverableActions.getByRole('button',{name:'取消',exact:true}).click();
      let delivery=await domain(page,operator.token,'project.deliverable.submit',{projectId:project.id,milestoneCode:milestone.milestoneCode,deliverableKey:'edge-package',name:'边缘分发包',businessVersion:'1.0',required:true,fileName:'edge-package.zip',fileDigest:'sha256:e2e-edge-package'});delivery=await domain(page,reviewer.token,'project.deliverable.review',{deliverableId:delivery.deliverableId,expectedVersion:delivery.version,decision:'accepted',comment:'交付验收通过'});await switchUi(page,'reviewer',process.env.RZ_E2E_REVIEWER_PASSWORD);await showRecord(page,reviewer.token,'deliverables','边缘分发包');await capture(page,{scenarioId:'deliverable_review',workflowStepId:null,roleId:'operations_reviewer',moduleId:'deliverables',actionId:null,stateBefore:'交付成果待复核',stateAfter:'交付详情显示已接受',controlVerified:true});
      await domain(page,dispatcher.token,'project.milestone.complete',{milestoneId:milestone.milestoneId,expectedVersion:milestone.version,comment:'里程碑完成'});let latest=await invoke(page,'get',[dispatcher.token,'project',project.id]).then(unwrap);let closing=await domain(page,dispatcher.token,'project.request_close',{projectId:project.id,expectedVersion:latest.version,comment:'申请项目关闭'});await switchUi(page,'dispatcher',password);await showRecord(page,dispatcher.token,'projects',uniqueName);await capture(page,{scenarioId:'project_close_request',workflowStepId:'close',roleId:'operations_dispatcher',moduleId:'projects',actionId:null,stateBefore:'项目处于进行中',stateAfter:'项目详情显示待关闭复核',controlVerified:false});
      closing=await domain(page,reviewer.token,'project.approve_close',{projectId:project.id,expectedVersion:closing.version,comment:'复核关闭通过'});await switchUi(page,'reviewer',process.env.RZ_E2E_REVIEWER_PASSWORD);await showRecord(page,reviewer.token,'projects',uniqueName);await capture(page,{scenarioId:'project_close_review',workflowStepId:null,roleId:'operations_reviewer',moduleId:'projects',actionId:null,stateBefore:'项目待关闭复核',stateAfter:'项目详情显示已关闭',controlVerified:false});
    }
    await app.close(); app = undefined;

    app = await electron.launch({ executablePath, env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
    page = await app.firstWindow();
    await uiLogin(page);
    module = await projectModuleName(page);
    await page.getByRole('button', { name: module.name, exact: true }).click();
    await page.getByPlaceholder('搜索记录').fill(uniqueName);
    const restartedRow = page.getByRole('row').filter({ hasText: uniqueName });
    await restartedRow.waitFor();
    const expectedStatus=process.env.RZ_E2E_TEMPLATE_ID==='project_task_management'?'closed':'active';
    if (!String(await restartedRow.textContent()).includes(expectedStatus)) throw new Error(`Project status '${expectedStatus}' did not persist after restart.`);
    await app.close(); app = undefined;
  } finally { if (app) await app.close().catch(() => undefined); }
};
