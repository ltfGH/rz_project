import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { loadRuntimeBlueprint } from '../core/blueprint-loader';
import { PluginHost } from '../core/plugin-host';
import { PluginRegistry } from '../core/plugin-registry';
import { loadProductionPluginCatalog } from '../core/production-plugin-loader';
import { verifyProjectResources } from '../core/project-lock';
import { compileSchema } from '../core/schema-compiler';
import type { RuntimeBlueprint, RuntimeEntity } from '../shared/blueprint';
import { getMaterialActionFallbackBehavior, getMaterialActionInputLabels, getMaterialDescriptor } from './material-descriptors';
import { moduleForMaterialAction } from './screenshot-evidence';
import { loadStandardTemplateCatalog } from './standard-project';

const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),text=z.string().trim().min(1).max(500);
const relativePath=z.string().trim().min(1).max(500).refine((value)=>!value.includes('\\')&&!value.startsWith('/')&&!/^[A-Za-z]:/.test(value)&&!value.split('/').includes('..'),'relative path required');
const sourceManifestSchema=z.object({
  manifestVersion:z.literal('1.0'),templateId:id,totalFiles:z.number().int().positive().max(50_000),totalLines:z.number().int().positive().max(20_000_000),sha256:sha,
  files:z.array(z.object({path:relativePath,lines:z.number().int().nonnegative(),bytes:z.number().int().nonnegative(),sha256:sha}).strict()).min(1).max(50_000)
}).strict();
const captureSchema=z.object({
  scenarioId:id,stepId:id,workflowStepId:id.nullable(),roleId:id,moduleId:id.nullable(),actionId:z.string().nullable(),stateBefore:text,stateAfter:text,
  executableSha256:sha,blueprintSha256:sha,imageSha256:sha,fileName:z.string().regex(/^[a-z0-9][a-z0-9_-]*\.png$/),
  width:z.number().int().min(320).max(10_000),height:z.number().int().min(240).max(10_000),
  perceptualDigest:z.string().regex(/^[a-f0-9]{16,128}$/),controlVerified:z.boolean()
}).strict();
const screenshotManifestSchema=z.object({
  manifestVersion:z.literal('2.0'),templateId:id,executableSha256:sha,blueprintSha256:sha,captures:z.array(captureSchema).min(12).max(18)
}).strict();
const acceptanceSchema=z.object({
  receiptVersion:z.literal('1.0'),status:z.literal('passed'),generatedAt:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/),templateId:id,businessRows:z.literal(1000),
  executableSha256:sha,blueprintSha256:sha,resourceManifestSha256:sha,
  checks:z.object({package:z.literal('passed'),workflow:z.literal('passed'),persistence:z.literal('passed')}).strict()
}).strict();
const runtimePolicySchema=z.object({platform:z.literal('Windows 10/11 x64'),installationMode:z.literal('当前用户安装'),dataPolicy:z.literal('业务数据存放在当前 Windows 用户的应用数据目录'),backupPolicy:z.literal('系统管理员通过数据与备份模块创建和恢复校验后的数据库快照'),offline:z.literal(true)}).strict();

export interface MaterialFactsInput{
  readonly resourcesDirectory:string;readonly templateId:string;
  readonly sourceManifest:unknown;readonly screenshotManifest:unknown;readonly acceptanceReceipt:unknown;
}
export interface MaterialDatabaseColumn{readonly position:number;readonly name:string;readonly type:string;readonly notNull:boolean;readonly defaultValue:string|null;readonly primaryKeyPosition:number;}
export interface MaterialDatabaseForeignKey{readonly id:number;readonly sequence:number;readonly targetTable:string;readonly fromColumn:string;readonly toColumn:string;readonly onUpdate:string;readonly onDelete:string;readonly match:string;}
export interface MaterialDatabaseIndex{readonly name:string;readonly unique:boolean;readonly origin:string;readonly partial:boolean;readonly columns:readonly string[];}
export interface MaterialDatabaseTable{readonly name:string;readonly kind:'business'|'system';readonly entityId:string|null;readonly columns:readonly MaterialDatabaseColumn[];readonly foreignKeys:readonly MaterialDatabaseForeignKey[];readonly indexes:readonly MaterialDatabaseIndex[];}

function fail(code:string):never{throw new Error(`MATERIAL_FACTS_${code}`);}
function hash(value:Buffer|string):string{return crypto.createHash('sha256').update(value).digest('hex');}
function canonical(value:unknown):string{
  if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number')return JSON.stringify(value);
  if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;
  if(!value||typeof value!=='object')return fail('NON_CANONICAL');
  return`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
}
function deepFreeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}return value;}
function parse<T>(schema:z.ZodType<T>,value:unknown,code:string):T{const result=schema.safeParse(value);if(!result.success)return fail(code);return result.data;}
function quoted(name:string):string{return`"${name.replaceAll('"','""')}"`;}
function sourceDigest(files:readonly{path:string;lines:number;bytes:number;sha256:string}[]):string{return hash(files.map((file)=>`${file.path}|${file.lines}|${file.bytes}|${file.sha256}`).join('\n'));}

function databaseFacts(blueprint:RuntimeBlueprint){
  const schema=compileSchema(blueprint),database=new DatabaseSync(':memory:');
  try{
    database.exec('PRAGMA foreign_keys = ON;');for(const migration of schema.migrations)for(const statement of migration.statements)database.exec(statement);
    const names=(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()as unknown as Array<{name:string}>).map((row)=>row.name);
    const byTable=new Map(Object.entries(schema.entityTables).map(([entityId,table])=>[table,entityId]));
    const tables=names.map((name):MaterialDatabaseTable=>{
      const columns=(database.prepare(`PRAGMA table_info(${quoted(name)})`).all()as unknown as Array<{cid:number;name:string;type:string;notnull:number;dflt_value:string|null;pk:number}>).map((column)=>Object.freeze({position:column.cid,name:column.name,type:column.type,notNull:column.notnull===1,defaultValue:column.dflt_value,primaryKeyPosition:column.pk}));
      const foreignKeys=(database.prepare(`PRAGMA foreign_key_list(${quoted(name)})`).all()as unknown as Array<{id:number;seq:number;table:string;from:string;to:string;on_update:string;on_delete:string;match:string}>).map((item)=>Object.freeze({id:item.id,sequence:item.seq,targetTable:item.table,fromColumn:item.from,toColumn:item.to,onUpdate:item.on_update,onDelete:item.on_delete,match:item.match}));
      const indexes=(database.prepare(`PRAGMA index_list(${quoted(name)})`).all()as unknown as Array<{name:string;unique:number;origin:string;partial:number}>).map((item)=>Object.freeze({name:item.name,unique:item.unique===1,origin:item.origin,partial:item.partial===1,columns:Object.freeze((database.prepare(`PRAGMA index_info(${quoted(item.name)})`).all()as unknown as Array<{seqno:number;name:string}>).sort((a,b)=>a.seqno-b.seqno).map((column)=>column.name))}));
      return Object.freeze({name,kind:name.startsWith('biz_')?'business':'system',entityId:byTable.get(name)??null,columns:Object.freeze(columns),foreignKeys:Object.freeze(foreignKeys),indexes:Object.freeze(indexes)})as MaterialDatabaseTable;
    });
    return Object.freeze({schemaVersion:schema.version,schemaDigest:schema.digest,tables:Object.freeze(tables)});
  }finally{database.close();}
}

function entityFact(entity:RuntimeEntity,isCore:boolean){return Object.freeze({
  id:entity.id,name:entity.name,isCore,retention:entity.retention,history:entity.history,
  fields:Object.freeze(entity.fields.map((field)=>Object.freeze({id:field.id,name:field.name,type:field.type,required:field.required,unique:field.unique})))
});}

export function buildMaterialFacts(input:MaterialFactsInput){
  if(!input||typeof input.resourcesDirectory!=='string'||typeof input.templateId!=='string')return fail('INPUT_INVALID');
  let verified;try{verified=verifyProjectResources(input.resourcesDirectory);}catch{return fail('RESOURCE_INVALID');}
  const registry=new PluginRegistry();try{for(const plugin of loadProductionPluginCatalog(verified.productionCatalogPath))registry.register(plugin);}catch{return fail('PLUGIN_CATALOG_INVALID');}
  let blueprint:RuntimeBlueprint;try{blueprint=loadRuntimeBlueprint(verified.blueprintText,verified.blueprintSha256,registry);registry.assertLocked(verified.domainLock);}catch{return fail('BLUEPRINT_INVALID');}
  let seedBaseline:string;try{const seed=JSON.parse(verified.seedText)as{baseline?:unknown};if(typeof seed.baseline!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(seed.baseline))return fail('SEED_INVALID');seedBaseline=seed.baseline;}catch{return fail('SEED_INVALID');}
  const standard=loadStandardTemplateCatalog().templates.find((entry)=>entry.id===input.templateId);if(!standard)return fail('TEMPLATE_INVALID');
  if(blueprint.plugins.map((item)=>item.id).sort().join()!==standard.packs.map((item)=>item.id).sort().join())return fail('TEMPLATE_PACK_MISMATCH');
  const descriptor=getMaterialDescriptor(input.templateId),source=parse(sourceManifestSchema,input.sourceManifest,'SOURCE_INVALID');
  const screenshots=parse(screenshotManifestSchema,input.screenshotManifest,'SCREENSHOTS_INVALID'),acceptance=parse(acceptanceSchema,input.acceptanceReceipt,'ACCEPTANCE_INVALID');
  const runtimePolicy=parse(runtimePolicySchema,verified.projectLock.runtimePolicy,'RUNTIME_POLICY_INVALID');
  if(source.templateId!==input.templateId||screenshots.templateId!==input.templateId||acceptance.templateId!==input.templateId)return fail('TEMPLATE_EVIDENCE_MISMATCH');
  if(new Set(source.files.map((file)=>file.path)).size!==source.files.length||source.files.length!==source.totalFiles||source.files.reduce((sum,file)=>sum+file.lines,0)!==source.totalLines||sourceDigest(source.files)!==source.sha256)return fail('SOURCE_DIGEST_MISMATCH');
  const manifestHash=hash(fs.readFileSync(`${input.resourcesDirectory}/resource-manifest.json`));
  if(screenshots.blueprintSha256!==verified.blueprintSha256||acceptance.blueprintSha256!==verified.blueprintSha256||screenshots.executableSha256!==acceptance.executableSha256||acceptance.resourceManifestSha256!==manifestHash)return fail('EVIDENCE_HASH_MISMATCH');
  const expectedScenarios=descriptor.screenshotScenarioIds;if(screenshots.captures.map((item)=>item.scenarioId).join()!==expectedScenarios.join())return fail('SCREENSHOT_PLAN_MISMATCH');
  const modules=new Map((blueprint.modules??[]).map((item)=>[item.id,item])),entities=new Map((blueprint.entities??[]).map((item)=>[item.id,item])),roles=new Map((blueprint.roles??[]).map((item)=>[item.id,item]));
  const host=new PluginHost();try{registry.activate(blueprint.plugins,host,verified.domainLock.dependencyOrder);}catch{return fail('PLUGIN_ACTIVATION_INVALID');}const activated=host.freeze();
  const permissionByAction=new Map(Object.entries(activated.domainActions).map(([action,entry])=>[action,(entry.value as{permission?:unknown}).permission]));
  const commands=Object.entries(descriptor.operationLabels).map(([commandId,label])=>{
    const permission=permissionByAction.get(commandId);if(typeof permission!=='string')return fail('COMMAND_REFERENCE_INVALID');
    const step=descriptor.workflowSteps.find((item)=>item.actionId===commandId),fallback=getMaterialActionFallbackBehavior(commandId);if(!step&&!fallback)return fail('COMMAND_BEHAVIOR_INVALID');
    const moduleId=moduleForMaterialAction(commandId,step?.moduleId??'');const ownerModule=(blueprint.modules??[]).find((module)=>module.id===moduleId);if(!ownerModule||!descriptor.modulePurposes[moduleId])return fail('COMMAND_MODULE_INVALID');
    return Object.freeze({id:commandId,label,permission,moduleId,entityId:ownerModule.entity,inputLabels:Object.freeze([...getMaterialActionInputLabels(commandId)]),precondition:step?.prerequisite??fallback!.precondition,result:step?.result??fallback!.result,failure:step?.failure??fallback!.failure});
  });
  const moduleFacts=Object.entries(descriptor.modulePurposes).map(([moduleId,purpose])=>{const module=modules.get(moduleId);if(!module)return fail('MODULE_REFERENCE_INVALID');return Object.freeze({id:module.id,name:module.name,entityId:module.entity,purpose,operations:Object.freeze(commands.filter((item)=>item.moduleId===module.id).map((item)=>item.id))});});
  const materialEntityIds=[...new Set([...descriptor.coreEntityIds,...moduleFacts.map((module)=>module.entityId)])];
  const entityFacts=materialEntityIds.map((entityId)=>{const entity=entities.get(entityId);if(!entity)return fail('ENTITY_REFERENCE_INVALID');return entityFact(entity,descriptor.coreEntityIds.includes(entityId));});
  const roleFacts=descriptor.roleProfileIds.map((roleId)=>{const role=roles.get(roleId);if(!role)return fail('ROLE_REFERENCE_INVALID');return Object.freeze({id:role.id,name:role.name,visibleOperations:Object.freeze(commands.filter((command)=>role.permissions.includes(command.permission)).map((command)=>command.id))});});
  const stepsById=new Map(descriptor.workflowSteps.map((item)=>[item.id,item]));
  if(new Set(screenshots.captures.map((capture)=>capture.stepId)).size!==screenshots.captures.length)return fail('SCREENSHOT_REFERENCE_INVALID');
  for(const capture of screenshots.captures){
    const workflowStep=capture.workflowStepId===null?undefined:stepsById.get(capture.workflowStepId);
    const captureRole=roles.get(capture.roleId),capturePermission=capture.actionId===null?undefined:permissionByAction.get(capture.actionId);
    const expectedModule=workflowStep?(workflowStep.actionId?moduleForMaterialAction(workflowStep.actionId,workflowStep.moduleId):workflowStep.moduleId):undefined;
    const invalidWorkflow=capture.workflowStepId!==null&&(!workflowStep||capture.moduleId!==expectedModule||(capture.actionId!==null&&capture.actionId!==(workflowStep.actionId??null)));
    const invalidAction=capture.actionId!==null&&(typeof capturePermission!=='string'||!captureRole?.permissions.includes(capturePermission));
    if(capture.blueprintSha256!==verified.blueprintSha256||capture.executableSha256!==acceptance.executableSha256||invalidWorkflow||(capture.moduleId!==null&&!modules.has(capture.moduleId))||!captureRole||invalidAction)return fail('SCREENSHOT_REFERENCE_INVALID');
  }
  const facts={
    factVersion:'1.0' as const,templateId:input.templateId,
    software:Object.freeze({id:blueprint.software.id,name:blueprint.software.name??'',version:blueprint.software.version??'',buildDate:seedBaseline.slice(0,10),materialGeneratedOn:acceptance.generatedAt.slice(0,10),purpose:blueprint.software.purpose??'',targetUsers:Object.freeze([...(blueprint.software.targetUsers??[])]),boundaries:Object.freeze([...(blueprint.software.boundaries??[])])}),
    modules:Object.freeze(moduleFacts),entities:Object.freeze(entityFacts),roles:Object.freeze(roleFacts),commands:Object.freeze(commands),
    workflows:Object.freeze([Object.freeze({id:`${input.templateId}_primary`,name:'核心业务流程',steps:Object.freeze(descriptor.workflowSteps.map((step)=>Object.freeze({...step})))})]),
    database:databaseFacts(blueprint),runtime:Object.freeze({...verified.projectLock.runtime,databaseSchemaVersion:verified.projectLock.databaseSchemaVersion,buildTarget:verified.projectLock.buildTarget,...runtimePolicy}),
    screenshots:Object.freeze({manifestVersion:screenshots.manifestVersion,executableSha256:screenshots.executableSha256,blueprintSha256:screenshots.blueprintSha256,captures:Object.freeze(screenshots.captures.map(({fileName,...capture})=>Object.freeze({...capture,fileName})))}),
    source:Object.freeze({...source,files:Object.freeze(source.files.map((file)=>Object.freeze({...file})))}),
    evidence:Object.freeze({status:acceptance.status,businessRows:acceptance.businessRows,resourceManifestSha256:acceptance.resourceManifestSha256,blueprintSha256:acceptance.blueprintSha256,executableSha256:acceptance.executableSha256,sourceSha256:source.sha256,screenshotManifestSha256:hash(canonical(screenshots)),checks:Object.freeze({...acceptance.checks})}),
    constraints:Object.freeze({validationNotes:Object.freeze([...descriptor.validationNotes]),unsupportedClaims:Object.freeze([...descriptor.unsupportedClaims])})
  };
  return deepFreeze(facts);
}

export function canonicalMaterialFacts(facts:ReturnType<typeof buildMaterialFacts>):string{return canonical(facts);}
