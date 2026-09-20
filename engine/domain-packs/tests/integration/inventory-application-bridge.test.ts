import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compileSchema } from '../../../desktop-runtime/src/core/schema-compiler';
import { openDatabase } from '../../../desktop-runtime/src/core/database';
import { ApplicationArchiveService } from '../../packs/application_archive/runtime/application-service';
import type { ApplicationContext } from '../../packs/application_archive/runtime/types';
import {
  createInventoryApplication,
  createInventoryApplicationCommand,
  inventoryApplicationApprovalHandler
} from '../../packs/inventory_application_bridge/runtime/inventory-application';
import type { InventoryContext } from '../../packs/inventory_batch/runtime/types';
import { AllowlistedDomainCommandBus } from '../../src/runtime/command-bus';
import type { DomainCommandExecutionContext } from '../../src/runtime/types';
import { loadPack } from '../../src/catalog/load-pack';
import { PackRegistry } from '../../src/catalog/registry';
import { composeDomainPacks } from '../../src/composition/compose';

const applicant = Object.freeze({ userId: 1, username: 'applicant', displayName: '申请人', roleId: 'application_applicant' });
const reviewer = Object.freeze({ userId: 2, username: 'reviewer', displayName: '审批人', roleId: 'application_reviewer' });

function composeBridge() {
  const registry = new PackRegistry();
  for (const id of ['inventory_batch', 'application_archive', 'inventory_application_bridge']) {
    registry.register(loadPack(path.resolve(__dirname, '..', '..', 'packs', id)));
  }
  return composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0',
    software: { id: 'inventory_application_test', name: '库存审批测试', version: '1.0.0', purpose: '验证审批扣减', targetUsers: ['申请审批人员'], boundaries: ['离线'], loginMode: 'required' },
    selections: [
      { id: 'inventory_batch', version: '1.0.0', config: { quantity_scale: 0 } },
      { id: 'application_archive', version: '1.0.0', config: { approval_levels: 1, reminder_days: 30 } },
      { id: 'inventory_application_bridge', version: '1.0.0', config: {} }
    ],
    coverage: { supported: ['审批领用'], unsupported: [] },
    materials: { developmentPurpose: '验证审批扣减', industry: '企业库存', technicalFeatures: ['SQLite事务'] }
  }, registry);
}

function setup(t: test.TestContext) {
  const composed = composeBridge(); assert.equal(composed.canGenerate, true, composed.summary);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-application-'));
  const schema = compileSchema(composed.blueprint as any);
  const database = openDatabase({ filename: path.join(directory, 'runtime.sqlite') }); database.migrate(schema);
  const now = '2026-09-20T08:00:00.000Z';
  database.prepare("INSERT INTO biz_material(code,name,unit,expiry_warning_days,active,version,created_at,updated_at) VALUES('MAT-1','滤芯','个',30,1,1,?,?)").run(now,now);
  database.prepare("INSERT INTO biz_warehouse(code,name,active,version,created_at,updated_at) VALUES('WH-1','主仓',1,1,?,?)").run(now,now);
  database.prepare("INSERT INTO biz_inventory_batch(code,material_code,warehouse_code,batch_no,produced_at,received_at,expires_at,quantity,active,version,created_at,updated_at) VALUES('BATCH-1','MAT-1','WH-1','LOT-1','2026-01-01','2026-01-02','2027-01-01',20,1,1,?,?)").run(now,now);
  t.after(()=>{database.close();fs.rmSync(directory,{recursive:true,force:true});});
  return { database };
}

let sequence=0;
function appContext(connection:any,actor:ApplicationContext['actor']=applicant,overrides:Partial<ApplicationContext>={}):ApplicationContext{return{connection,actor,config:{approvalLevels:1,reminderDays:30},requirePermission:()=>undefined,appendAudit:()=>undefined,identityHasRole:(id,role)=>(id===applicant.username&&role===applicant.roleId)||(id===reviewer.username&&role===reviewer.roleId),approvalCompletionHandlers:[],commandBus:{invoke:()=>undefined},now:()=>new Date('2026-09-20T08:00:00.000Z'),applicationCode:()=>`APP-I-${++sequence}`,nodeCode:()=>`NODE-I-${++sequence}`,recordCode:()=>`REC-I-${++sequence}`,fileVersionCode:()=>`FILE-I-${++sequence}`,certificateCode:()=>`CERT-I-${++sequence}`,reminderCode:()=>`REM-I-${++sequence}`,...overrides};}
function inventoryContext(execution:DomainCommandExecutionContext):InventoryContext{return{connection:execution.connection,actor:{...execution.actor,username:`application:${execution.actor.username}`,roleId:'inventory_application_bridge'},quantityScale:0,requirePermission:()=>undefined,appendAudit:()=>undefined,identityHasRole:()=>false,issueBlockers:[],now:()=>new Date('2026-09-20T08:00:00.000Z'),materialCode:()=>`MAT-X-${++sequence}`,warehouseCode:()=>`WH-X-${++sequence}`,batchCode:()=>`B-X-${++sequence}`,transactionCode:()=>`TX-I-${++sequence}`};}
function commandBus(connection:any){return new AllowlistedDomainCommandBus([createInventoryApplicationCommand(inventoryContext)],{connection,actor:reviewer,sourcePluginId:'inventory_application_bridge'});}

function submitted(runtime:ReturnType<typeof setup>){const service=new ApplicationArchiveService();let app=runtime.database.transaction(c=>createInventoryApplication({batchCode:'BATCH-1',quantity:3,purpose:'设备保养',title:'滤芯领用',content:'设备定期保养领用'},appContext(c)));app=runtime.database.transaction(c=>service.submitApplication({applicationId:app.applicationId,expectedVersion:app.version,comment:'提交'},appContext(c)));const node=runtime.database.prepare('SELECT id,version FROM biz_approval_node WHERE application_code=?').get(app.applicationCode)as{id:number;version:number};return{service,app,node};}
function quantity(runtime:ReturnType<typeof setup>){return Number((runtime.database.prepare("SELECT quantity FROM biz_inventory_batch WHERE code='BATCH-1'").get()as{quantity:number}).quantity);}

test('composes inventory fields and an immutable issue link',()=>{const result=composeBridge();assert.equal(result.canGenerate,true,result.summary);const entities=result.blueprint!.entities as any[];const application=entities.find(x=>x.id==='application');assert.ok(application.fields.some((x:any)=>x.id==='inventory_batch_code'));assert.ok(application.fields.some((x:any)=>x.id==='inventory_quantity'));assert.equal(entities.find(x=>x.id==='application_inventory_issue').retention,'append_only');});

test('deducts inventory once only after final approval',t=>{const runtime=setup(t),x=submitted(runtime);assert.equal(quantity(runtime),20);const approved=runtime.database.transaction(c=>x.service.approveCurrentNode({applicationId:x.app.applicationId,expectedApplicationVersion:x.app.version,nodeId:x.node.id,expectedNodeVersion:x.node.version,comment:'批准'},appContext(c,reviewer,{commandBus:commandBus(c),approvalCompletionHandlers:[inventoryApplicationApprovalHandler]})));assert.equal(approved.status,'approved');assert.equal(quantity(runtime),17);runtime.database.transaction(c=>inventoryApplicationApprovalHandler({applicationId:approved.applicationId,applicationCode:approved.applicationCode,applicationType:'inventory_issue',approvalRound:approved.approvalRound,applicantId:'applicant'},commandBus(c)));assert.equal(quantity(runtime),17);assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_inventory_transaction').get()as{count:number}).count,1);});

test('rejection does not deduct inventory',t=>{const runtime=setup(t),x=submitted(runtime);runtime.database.transaction(c=>x.service.rejectCurrentNode({applicationId:x.app.applicationId,expectedApplicationVersion:x.app.version,nodeId:x.node.id,expectedNodeVersion:x.node.version,reason:'不批准'},appContext(c,reviewer)));assert.equal(quantity(runtime),20);assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_inventory_transaction').get()as{count:number}).count,0);});

test('rolls back inventory, ledger, link and approval when a later handler fails',t=>{const runtime=setup(t),x=submitted(runtime);assert.throws(()=>runtime.database.transaction(c=>x.service.approveCurrentNode({applicationId:x.app.applicationId,expectedApplicationVersion:x.app.version,nodeId:x.node.id,expectedNodeVersion:x.node.version,comment:'批准'},appContext(c,reviewer,{commandBus:commandBus(c),approvalCompletionHandlers:[inventoryApplicationApprovalHandler,()=>{throw new Error('later handler failed');}]}))),/later handler failed/);assert.equal(quantity(runtime),20);assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_inventory_transaction').get()as{count:number}).count,0);assert.equal((runtime.database.prepare('SELECT COUNT(*) count FROM biz_application_inventory_issue').get()as{count:number}).count,0);assert.equal((runtime.database.prepare('SELECT status FROM biz_application WHERE id=?').get(x.app.applicationId)as{status:string}).status,'approving');});
