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
