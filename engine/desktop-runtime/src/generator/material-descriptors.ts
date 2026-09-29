import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { loadStandardTemplateCatalog } from './standard-project';

const id=z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const actionId=z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
const display=z.string().trim().min(2).max(240);
const roleId=z.enum(['operations_dispatcher','operations_operator','operations_reviewer','operations_admin']);
const stepSchema=z.object({
  id,label:display,moduleId:id,entityId:id,actionId:actionId.optional(),
  prerequisite:display,result:display,failure:display
}).strict();
const descriptorSchema=z.object({
  id,modulePurposes:z.record(id,display),operationLabels:z.record(actionId,display),
  validationNotes:z.array(display).min(2).max(20),workflowSteps:z.array(stepSchema).min(4).max(10),
  unsupportedClaims:z.array(display).min(2).max(20),screenshotScenarioIds:z.array(id).min(12).max(18),
  coreEntityIds:z.array(id).min(2).max(4),roleProfileIds:z.array(roleId).length(4)
}).strict();
const catalogSchema=z.object({catalogVersion:z.literal('1.0'),templates:z.array(descriptorSchema).length(8)}).strict();

export type MaterialWorkflowStep=z.infer<typeof stepSchema>;
export type MaterialDescriptor=z.infer<typeof descriptorSchema>;
export type MaterialDescriptorCatalog=z.infer<typeof catalogSchema>;

const ACTION_INPUT_LABELS:Readonly<Record<string,readonly string[]>>=Object.freeze({
  'application.create':Object.freeze(['申请类型','申请标题','申请正文']),
  'application.submit':Object.freeze(['提交说明']),
  'application.approve':Object.freeze(['审批节点 ID','节点版本','审批意见']),
  'application.reject':Object.freeze(['审批节点 ID','节点版本','驳回原因']),
  'application.revise':Object.freeze(['修订说明']),
  'application.archive':Object.freeze(['归档文件版本编码','归档说明']),
  'asset.inspection.plan.create':Object.freeze(['计划名称','周期天数','执行说明']),
  'asset.inspection.task.create':Object.freeze(['任务标题','执行账号','计划时间','检查项','检查标准']),
  'asset.work_order.create':Object.freeze(['工单标题','问题描述','服务编码','优先级']),
  'inspection.start':Object.freeze([]),'inspection.record':Object.freeze(['检查项 ID','检查结果','异常描述','处置说明']),'inspection.submit':Object.freeze([]),'inspection.archive':Object.freeze(['归档说明']),
  'work_order.dispatch':Object.freeze(['处理账号','分派说明']),'work_order.accept':Object.freeze([]),'work_order.add_processing_record':Object.freeze(['处理记录']),'work_order.submit_resolution':Object.freeze(['解决说明']),'work_order.approve_close':Object.freeze(['复核说明']),
  'inventory.batch.receive_new':Object.freeze(['物料编码','仓库编码','批次号','入库数量','生产日期','入库日期','到期日期','入库说明']),
  'inventory.application.create':Object.freeze(['申领数量','申领用途','申请标题','申请正文']),
  'project.create':Object.freeze(['项目名称','项目经理账号','计划开始日期','计划结束日期']),'project.activate':Object.freeze([]),
  'project.task.create':Object.freeze(['里程碑编码','任务标题','任务说明','负责人账号','任务权重','关闭必需']),
  'project.risk.create':Object.freeze(['风险标题','风险说明','风险等级']),
  'project.deliverable.submit':Object.freeze(['里程碑编码','交付物键','交付物名称','业务版本','关闭必需','文件名称','文件摘要']),
  'project.deliverable.review':Object.freeze(['复核结论','复核意见']),
  'project.delivery.archive':Object.freeze(['交付版本 ID','文件版本编码']),
  'project.request_close':Object.freeze(['申请说明'])
});
const ACTION_FALLBACK_BEHAVIOR:Readonly<Record<string,Readonly<{precondition:string;result:string;failure:string}>>>=Object.freeze({
  'inspection.record':Object.freeze({precondition:'巡检任务处于执行中且检查项属于当前任务',result:'检查结果、异常发现和处置说明写入对应检查项',failure:'检查项、任务版本或异常说明不符合要求时拒绝记录'})
});
export function getMaterialActionInputLabels(actionIdValue:string):readonly string[]{const found=ACTION_INPUT_LABELS[actionIdValue];if(!found)throw new Error(`Material action '${actionIdValue}' has no fixed input labels.`);return found;}
export function getMaterialActionFallbackBehavior(actionIdValue:string){return ACTION_FALLBACK_BEHAVIOR[actionIdValue];}

function defaultCatalogPath():string{
  const candidates=[
    path.resolve(__dirname,'..','..','standard-materials','catalog.json'),
    path.resolve(__dirname,'..','..','..','standard-materials','catalog.json')
  ];
  const found=candidates.find((candidate)=>fs.existsSync(candidate));
  if(!found)throw new Error('Material descriptor catalog was not found.');return found;
}
function deepFreeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}return value;}
function assertSafe(value:unknown):void{
  if(Array.isArray(value)){for(const item of value)assertSafe(item);return;}
  if(!value||typeof value!=='object')return;
  for(const[key,child]of Object.entries(value)){
    if(/^(?:on[A-Z].*|script|execute|function|command|sql)$/i.test(key))throw new Error('Material descriptor contains an executable-looking key.');
    if(typeof child==='string'&&/(?:<script\b|javascript:|\bSELECT\s+.+\s+FROM\b|\bInvoke-Expression\b)/i.test(child))throw new Error('Material descriptor contains executable content.');
    assertSafe(child);
  }
}
function unique(values:readonly string[],message:string):void{if(new Set(values).size!==values.length)throw new Error(message);}

export function loadMaterialDescriptorCatalog(filename=defaultCatalogPath()):MaterialDescriptorCatalog{
  const raw=JSON.parse(fs.readFileSync(filename,'utf8'));assertSafe(raw);const parsed=catalogSchema.parse(raw);
  const standard=loadStandardTemplateCatalog(),expected=standard.templates.map((entry)=>entry.id);
  if(parsed.templates.map((entry)=>entry.id).join()!==expected.join())throw new Error('Material template ids must match the sorted standard catalog.');
  for(const descriptor of parsed.templates){
    const template=standard.templates.find((entry)=>entry.id===descriptor.id)!;
    const entities=new Set(template.aliasableEntities),modules=new Set(template.aliasableModules);
    unique(descriptor.coreEntityIds,`Template '${descriptor.id}' has duplicate core entities.`);
    unique(descriptor.roleProfileIds,`Template '${descriptor.id}' has duplicate role profiles.`);
    unique(descriptor.screenshotScenarioIds,`Template '${descriptor.id}' has duplicate screenshot scenarios.`);
    unique(descriptor.workflowSteps.map((step)=>step.id),`Template '${descriptor.id}' has duplicate workflow steps.`);
    for(const entity of descriptor.coreEntityIds)if(!entities.has(entity))throw new Error(`Template '${descriptor.id}' references unknown entity '${entity}'.`);
    for(const moduleId of Object.keys(descriptor.modulePurposes))if(!modules.has(moduleId))throw new Error(`Template '${descriptor.id}' references unknown module '${moduleId}'.`);
    for(const role of descriptor.roleProfileIds)if(!(role in template.roleProfiles))throw new Error(`Template '${descriptor.id}' references unknown role '${role}'.`);
    for(const[action,label]of Object.entries(descriptor.operationLabels))if(action===label||/^[a-z][a-z0-9_.]+$/.test(label))throw new Error(`Template '${descriptor.id}' exposes an internal action id.`);
    for(const action of Object.keys(descriptor.operationLabels))getMaterialActionInputLabels(action);
    for(const step of descriptor.workflowSteps){
      if(!modules.has(step.moduleId)||!descriptor.modulePurposes[step.moduleId])throw new Error(`Template '${descriptor.id}' workflow references unknown module '${step.moduleId}'.`);
      if(!entities.has(step.entityId))throw new Error(`Template '${descriptor.id}' workflow references unknown entity '${step.entityId}'.`);
      if(step.actionId&&!descriptor.operationLabels[step.actionId])throw new Error(`Template '${descriptor.id}' workflow action has no display label.`);
    }
  }
  return deepFreeze(parsed);
}

let cached:MaterialDescriptorCatalog|undefined;
export function getMaterialDescriptor(templateId:string):MaterialDescriptor{
  cached??=loadMaterialDescriptorCatalog();const found=cached.templates.find((entry)=>entry.id===templateId);
  if(!found)throw new Error(`Material template '${templateId}' is not supported.`);return found;
}
