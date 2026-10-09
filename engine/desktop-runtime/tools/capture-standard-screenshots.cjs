'use strict';

require('tsx/cjs');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const{DatabaseSync}=require('node:sqlite');
const{_electron:electron}=require('playwright');
const{loadRuntimeBlueprint}=require('../src/core/blueprint-loader.ts');
const{PluginHost}=require('../src/core/plugin-host.ts');
const{PluginRegistry}=require('../src/core/plugin-registry.ts');
const{loadProductionPluginCatalog}=require('../src/core/production-plugin-loader.ts');
const{verifyProjectResources}=require('../src/core/project-lock.ts');
const{verifyPassword}=require('../src/core/passwords.ts');
const{getMaterialDescriptor}=require('../src/generator/material-descriptors.ts');
const{assertScreenshotEvidence,assertWorkflowCaptureBinding,assertWorkflowCaptureMetadata,buildStandardScreenshotPlan,inspectPng}=require('../src/generator/screenshot-evidence.ts');

function argument(name){const indexes=process.argv.flatMap((value,index)=>value===name?[index]:[]);if(indexes.length!==1)return undefined;return process.argv[indexes[0]+1];}
function requiredPath(name,kind){const value=argument(name);if(!value||!path.isAbsolute(value))throw new Error(`${name} must be an absolute path.`);const resolved=path.resolve(value),stat=fs.lstatSync(resolved);if(stat.isSymbolicLink()||(kind==='file'&&!stat.isFile())||(kind==='directory'&&!stat.isDirectory()))throw new Error(`${name} has an invalid type.`);return resolved;}
function requiredTemplate(){const value=argument('--template');if(!value||!/^[a-z][a-z0-9_]{1,63}$/.test(value))throw new Error('--template is invalid.');return value;}
function sha256(filename){return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');}
function transientLaunchFailure(error){const message=error instanceof Error?error.message:String(error);return /timeout[^\r\n]*(?:electron|window)|(?:electron|window)[^\r\n]*timeout/i.test(message);}
async function launchCaptureApplication(electronApi,launchOptions){
  let lastError;
  for(let attempt=0;attempt<2;attempt++){
    let application;
    try{
      application=await electronApi.launch({...launchOptions,timeout:60_000});
      const page=await application.firstWindow({timeout:60_000});
      return{app:application,page};
    }catch(error){
      lastError=error;
      if(application)await application.close().catch(()=>undefined);
      if(attempt!==0||!transientLaunchFailure(error))throw error;
    }
  }
  throw lastError;
}
function workflowCaptures(){
  const value=argument('--workflow-captures');if(!value)return new Map();if(!path.isAbsolute(value))throw new Error('--workflow-captures must be absolute.');const root=path.resolve(value),stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('--workflow-captures has an invalid type.');
  const result=new Map();for(const indexName of fs.readdirSync(root).filter((name)=>name.endsWith('.captures.json')).sort()){
    const indexPath=path.join(root,indexName),indexStat=fs.lstatSync(indexPath);if(!indexStat.isFile()||indexStat.isSymbolicLink()||indexStat.size>1024*1024)throw new Error('Workflow capture index is invalid.');const entries=JSON.parse(fs.readFileSync(indexPath,'utf8'));
    if(!Array.isArray(entries))throw new Error('Workflow capture index must be an array.');for(const entry of entries){if(!entry||typeof entry!=='object'||!/^[a-z][a-z0-9_]{1,63}$/.test(entry.scenarioId)||!/^[a-z0-9][a-z0-9_-]*\.png$/.test(entry.fileName)||result.has(entry.scenarioId))throw new Error('Workflow capture entry is invalid.');const source=path.resolve(root,entry.fileName),sourceStat=fs.lstatSync(source);if(path.dirname(source)!==root||!sourceStat.isFile()||sourceStat.isSymbolicLink())throw new Error('Workflow capture image is invalid.');result.set(entry.scenarioId,{...entry,source});}
  }
  return result;
}

async function main(){
  const executablePath=requiredPath('--executable','file'),blueprintPath=requiredPath('--blueprint','file'),output=requiredPath('--output','directory'),templateId=requiredTemplate();
  const executableSha256=sha256(executablePath),blueprintSha256=sha256(blueprintPath),packagedRoot=path.join(path.dirname(executablePath),'resources','runtime-resources'),verified=verifyProjectResources(packagedRoot);if(verified.blueprintSha256!==blueprintSha256)throw new Error('Packaged blueprint does not match the locked capture blueprint.');
  const registry=new PluginRegistry();for(const plugin of loadProductionPluginCatalog(verified.productionCatalogPath))registry.register(plugin);const blueprint=loadRuntimeBlueprint(verified.blueprintText,verified.blueprintSha256,registry);registry.assertLocked(verified.domainLock);const host=new PluginHost();registry.activate(blueprint.plugins,host,verified.domainLock.dependencyOrder);const activated=host.freeze(),permissionByAction=new Map(Object.entries(activated.domainActions).map(([action,entry])=>[action,entry.value.permission]));
  const descriptor=getMaterialDescriptor(templateId),modules=new Map(blueprint.modules.map((module)=>[module.id,module])),plan=buildStandardScreenshotPlan(descriptor,blueprint),workflow=workflowCaptures(),userData=fs.mkdtempSync(path.join(os.tmpdir(),'rz-standard-capture-'));
  for(const scenarioId of workflow.keys())if(!descriptor.screenshotScenarioIds.includes(scenarioId))throw new Error(`Workflow capture scenario '${scenarioId}' is not declared.`);
  const accounts={operations_dispatcher:['dispatcher',process.env.RZ_E2E_DISPATCHER_PASSWORD],operations_operator:['operator',process.env.RZ_E2E_OPERATOR_PASSWORD],operations_reviewer:['reviewer',process.env.RZ_E2E_REVIEWER_PASSWORD],operations_admin:['administrator',process.env.RZ_E2E_ADMINISTRATOR_PASSWORD]};
  for(const[role,account]of Object.entries(accounts))if(!account[1])throw new Error(`Capture credential is unavailable for '${role}'.`);
  const seedUsers=new Map(JSON.parse(verified.seedText).users.map((user)=>[user.username,user]));
  for(const[role,[username,password]]of Object.entries(accounts)){const user=seedUsers.get(username);if(!user||!await verifyPassword(password,user.passwordDigest))throw new Error(`Capture credential does not match packaged seed for '${role}'.`);}
  let app;
  try{
    const launched=await launchCaptureApplication(electron,{executablePath,env:{...process.env,RZ_RUNTIME_USER_DATA:userData}});app=launched.app;const page=launched.page;let currentRole;
    const logout=async()=>{if(!currentRole)return;const button=page.getByRole('button',{name:'退出登录'});if(await button.count())await button.click();await page.getByLabel('账号').waitFor();currentRole=undefined;};
    const login=async(roleId)=>{if(currentRole===roleId)return;await logout();const account=accounts[roleId],usernameInput=page.getByLabel('账号'),passwordInput=page.getByLabel('密码');let inputMatches=false;for(let attempt=0;attempt<3;attempt++){await usernameInput.fill(account[0]);await passwordInput.fill(account[1]);await page.waitForTimeout(50);inputMatches=(await usernameInput.inputValue())===account[0]&&(await passwordInput.inputValue())===account[1];if(inputMatches)break;}if(!inputMatches)throw new Error(`Capture login inputs did not settle for ${roleId}.`);await page.getByRole('button',{name:'登录'}).click();try{await page.getByRole('navigation',{name:'主导航'}).waitFor();}catch{const loginVisible=await usernameInput.isVisible().catch(()=>false),alerts=await page.getByRole('alert').allTextContents().catch(()=>[]),windows=app.windows().length,seedUser=seedUsers.get(account[0]);let databaseState='unavailable';try{const database=new DatabaseSync(path.join(userData,'runtime.sqlite'),{readOnly:true});try{const row=database.prepare('SELECT password_digest,enabled,failed_attempts,locked_until FROM sys_user WHERE username=?').get(account[0]);databaseState=row?`digestMatchesSeed=${row.password_digest===seedUser.passwordDigest},enabled=${row.enabled},failedAttempts=${row.failed_attempts},locked=${Boolean(row.locked_until)}`:'missing-user';}finally{database.close();}}catch{}throw new Error(`Capture login failed for ${roleId}; loginVisible=${loginVisible}; windows=${windows}; alerts=${alerts.join('|')||'none'}; ${databaseState}`);}currentRole=roleId;};
    const closePanels=async()=>{for(const name of ['取消','关闭详情']){const buttons=page.getByRole('button',{name,exact:true});if(await buttons.count()&&await buttons.first().isVisible())await buttons.first().click().catch(()=>undefined);}};
    const navigate=async(moduleId)=>{const module=modules.get(moduleId);if(!module)throw new Error(`Capture plan references unknown module '${moduleId}'.`);await closePanels();await page.getByRole('button',{name:module.name,exact:true}).click();if(moduleId!=='maintenance')await page.getByPlaceholder('搜索记录').waitFor();return module;};
    const openDetail=async(offset=0)=>{const views=page.getByRole('button',{name:/^查看 /}),count=await views.count();if(count===0)throw new Error('Capture module has no record detail.');await views.nth(offset%Math.min(count,20)).click();await page.getByRole('complementary',{name:'记录详情'}).waitFor();};
    const openAction=async(item)=>{
      if(!item.actionId||!item.actionLabel||!item.moduleId)throw new Error(`Action capture '${item.scenarioId}' has no bound command.`);
      for(const roleId of Object.keys(accounts)){
        await login(roleId);await navigate(item.moduleId);
        const moduleControl=page.getByRole('region',{name:'模块操作'}).getByRole('button',{name:item.actionLabel,exact:true});
        if(await moduleControl.count()&&await moduleControl.first().isVisible()){await moduleControl.first().click();return roleId;}
        const views=page.getByRole('button',{name:/^查看 /}),count=Math.min(await views.count(),20);
        for(let index=0;index<count;index++){await views.nth(index).click();const detail=page.getByRole('complementary',{name:'记录详情'});await detail.waitFor();const control=detail.getByRole('button',{name:item.actionLabel,exact:true});if(await control.count()&&await control.first().isVisible()){await control.first().click();return roleId;}await page.getByRole('button',{name:'关闭详情',exact:true}).click();}
      }
      throw new Error(`Planned action control '${item.actionId}' was not visible.`);
    };
    const captures=[];
    for(const[planIndex,item]of plan.entries()){
      const supplied=workflow.get(item.scenarioId);
      if(supplied){
        assertWorkflowCaptureBinding(supplied,executableSha256,blueprintSha256);
        assertWorkflowCaptureMetadata(supplied,item,descriptor,blueprint,permissionByAction);
        const filename=path.join(output,item.fileName);fs.copyFileSync(supplied.source,filename);const inspected=inspectPng(filename);
        captures.push({scenarioId:item.scenarioId,stepId:item.stepId,workflowStepId:supplied.workflowStepId??null,roleId:supplied.roleId,moduleId:supplied.moduleId??null,actionId:supplied.actionId??null,stateBefore:supplied.stateBefore,stateAfter:supplied.stateAfter,executableSha256,blueprintSha256,imageSha256:sha256(filename),fileName:item.fileName,width:inspected.width,height:inspected.height,perceptualDigest:inspected.perceptualDigest,controlVerified:supplied.controlVerified===true});
        continue;
      }
      await page.setViewportSize(item.viewport==='minimum'?{width:1100,height:760}:{width:1440,height:960});let roleId=item.roleId,controlVerified=false;
      if(item.kind==='login'){await logout();await page.getByLabel('账号').fill('');await page.getByLabel('密码').fill('');if(await page.getByLabel('密码').inputValue()!=='')throw new Error('Password field was not empty before capture.');}
      else if(item.kind==='dashboard'){await login('operations_admin');await page.getByRole('button',{name:'运维总览',exact:true}).click();await page.getByRole('region',{name:'核心指标'}).waitFor();await page.locator('[data-dashboard-section]').first().waitFor();}
      else if(item.kind==='backup'){await login('operations_admin');await navigate(item.moduleId);}
      else if(item.kind==='action'){roleId=await openAction(item);controlVerified=true;}
      else{await login('operations_admin');await navigate(item.moduleId);if(item.kind==='detail'||item.kind==='state')await openDetail(planIndex);}
      const filename=path.join(output,item.fileName);await page.screenshot({path:filename,fullPage:true});const inspected=inspectPng(filename);
      captures.push({scenarioId:item.scenarioId,stepId:item.stepId,workflowStepId:item.workflowStepId,roleId,moduleId:item.moduleId,actionId:item.actionId,stateBefore:item.stateBefore,stateAfter:item.stateAfter,executableSha256,blueprintSha256,imageSha256:sha256(filename),fileName:item.fileName,width:inspected.width,height:inspected.height,perceptualDigest:inspected.perceptualDigest,controlVerified});
    }
    const manifest={manifestVersion:'2.0',templateId,executableSha256,blueprintSha256,captures};
    assertScreenshotEvidence(manifest,{templateId,executableSha256,blueprintSha256,screenshotScenarioIds:descriptor.screenshotScenarioIds},output);
    fs.writeFileSync(path.join(output,'screenshot-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,'utf8');
  }finally{if(app)await app.close().catch(()=>undefined);fs.rmSync(userData,{recursive:true,force:true});}
}

module.exports={launchCaptureApplication};
if(require.main===module)main().catch((error)=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
