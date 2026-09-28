import type { EntityRecordDto } from '../../shared/dto';

export type ActionScope = 'module' | 'record';
export type ActionFieldType = 'text' | 'number' | 'date' | 'select' | 'boolean';
export type ActionFormValue = string | boolean;

export interface ActionFieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly type: ActionFieldType;
  readonly required: boolean;
  readonly options?: readonly string[];
  readonly initial?: ActionFormValue;
  readonly sourceField?: string;
}

type BaseKind = 'none' | 'project' | 'project-child' | 'milestone' | 'task' | 'risk' | 'deliverable';
export interface ActionFormDefinition {
  readonly id: string;
  readonly label: string;
  readonly entityId: string;
  readonly scope: ActionScope;
  readonly fields: readonly ActionFieldDefinition[];
  readonly base: BaseKind;
}

const text = (id:string,label:string,options:Partial<ActionFieldDefinition>={}):ActionFieldDefinition => Object.freeze({id,label,type:'text',required:true,...options});
const number = (id:string,label:string,options:Partial<ActionFieldDefinition>={}):ActionFieldDefinition => Object.freeze({id,label,type:'number',required:true,...options});
const date = (id:string,label:string,sourceField?:string):ActionFieldDefinition => Object.freeze({id,label,type:'date',required:true,...(sourceField?{sourceField}:{})});
const boolean = (id:string,label:string,initial=true,sourceField?:string):ActionFieldDefinition => Object.freeze({id,label,type:'boolean',required:true,initial,...(sourceField?{sourceField}:{})});
const select = (id:string,label:string,options:string[]):ActionFieldDefinition => Object.freeze({id,label,type:'select',required:true,options:Object.freeze(options)});
const fields = (...values:ActionFieldDefinition[]) => Object.freeze(values);
const definition = (id:string,label:string,entityId:string,scope:ActionScope,base:BaseKind,items:readonly ActionFieldDefinition[]):ActionFormDefinition => Object.freeze({id,label,entityId,scope,base,fields:items});

const projectFields = fields(
  text('name','项目名称',{sourceField:'name'}), text('managerId','项目经理账号',{initial:'dispatcher',sourceField:'manager_id'}),
  date('plannedStartAt','计划开始日期','planned_start_at'), date('plannedEndAt','计划结束日期','planned_end_at')
);
const taskFields = fields(
  text('milestoneCode','里程碑编码',{required:false,sourceField:'milestone_code'}), text('title','任务标题',{sourceField:'title'}),
  text('description','任务说明',{sourceField:'description'}), text('assigneeId','负责人账号',{initial:'operator',sourceField:'assignee_id'}),
  number('weight','任务权重',{initial:'10',sourceField:'weight'}), boolean('required','关闭必需',true,'required')
);

const definitions = Object.freeze([
  definition('project.create','创建项目','project','module','none',projectFields),
  definition('project.update','修改项目','project','record','project',projectFields),
  definition('project.activate','激活项目','project','record','project',fields()),
  definition('project.request_close','申请关闭','project','record','project',fields(text('comment','申请说明'))),
  definition('project.reject_close','驳回关闭','project','record','project',fields(text('reason','驳回原因'))),
  definition('project.approve_close','复核关闭','project','record','project',fields(text('comment','复核说明'))),
  definition('project.milestone.create','创建里程碑','project','record','project-child',fields(text('name','里程碑名称'),date('dueAt','计划完成日期'))),
  definition('project.milestone.complete','完成里程碑','milestone','record','milestone',fields(text('comment','完成说明'))),
  definition('project.task.create','创建任务','project','record','project-child',taskFields),
  definition('project.task.update','修改任务','project_task','record','task',taskFields),
  definition('project.task.start','开始任务','project_task','record','task',fields()),
  definition('project.task.progress','填写进展','project_task','record','task',fields(text('note','进展说明'))),
  definition('project.task.submit','提交验收','project_task','record','task',fields()),
  definition('project.task.reject','驳回任务','project_task','record','task',fields(text('reason','驳回原因'))),
  definition('project.task.approve','验收任务','project_task','record','task',fields(text('comment','验收意见'))),
  definition('project.task.cancel','取消任务','project_task','record','task',fields(text('reason','取消原因'))),
  definition('project.task.restore','恢复任务','project_task','record','task',fields(text('reason','恢复原因'))),
  definition('project.risk.create','登记风险','project','record','project-child',fields(text('title','风险标题'),text('description','风险说明'),select('level','风险等级',['low','medium','high']))),
  definition('project.risk.mitigate','处置风险','project_risk','record','risk',fields(text('disposition','处置说明'))),
  definition('project.risk.close','关闭风险','project_risk','record','risk',fields(text('comment','关闭说明'))),
  definition('project.risk.reopen','重开风险','project_risk','record','risk',fields(text('reason','重开原因'))),
  definition('project.deliverable.submit','提交交付成果','project','record','project-child',fields(
    text('milestoneCode','里程碑编码',{required:false}),text('deliverableKey','交付物键'),text('name','交付物名称'),
    text('businessVersion','业务版本'),boolean('required','关闭必需'),text('fileName','文件名称'),text('fileDigest','文件摘要')
  )),
  definition('project.deliverable.review','复核交付成果','deliverable','record','deliverable',fields(select('decision','复核结论',['accepted','rejected']),text('comment','复核意见')))
]);

const byId = new Map(definitions.map((item) => [item.id,item]));
export const projectActionFormIds = Object.freeze(definitions.map((item) => item.id));
export function getProjectActionForm(actionId:string):ActionFormDefinition|undefined{return byId.get(actionId);}

function invalid():never{throw new Error('Invalid project action form input.');}
function missingRecord():never{throw new Error('Project action record is required.');}
function parseDate(value:string):string{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return invalid();const parsed=new Date(`${value}T00:00:00.000Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)return invalid();return value;}
function parseField(field:ActionFieldDefinition,value:unknown):unknown{
  if(field.type==='boolean'){if(value===true||value==='true')return true;if(value===false||value==='false')return false;return invalid();}
  if(typeof value!=='string')return invalid();const normalized=value.trim();
  if(!normalized){if(!field.required)return null;return invalid();}
  if(field.type==='number'){const parsed=Number(normalized);if(!Number.isSafeInteger(parsed)||parsed<=0)return invalid();return parsed;}
  if(field.type==='date')return parseDate(normalized);
  if(field.type==='select'&&!field.options?.includes(normalized))return invalid();
  return normalized;
}
function recordBase(kind:BaseKind,record?:EntityRecordDto):Record<string,unknown>{
  if(kind==='none')return{};if(!record)return missingRecord();
  if(kind==='project-child')return{projectId:record.id};
  const names={project:'projectId',milestone:'milestoneId',task:'taskId',risk:'riskId',deliverable:'deliverableId'} as const;
  return{[names[kind as keyof typeof names]]:record.id,expectedVersion:record.version};
}

export function buildProjectActionInput(definition:ActionFormDefinition,values:Readonly<Record<string,unknown>>,record?:EntityRecordDto):Readonly<Record<string,unknown>>{
  const allowed=new Set(definition.fields.map((field)=>field.id));if(Object.keys(values).some((key)=>!allowed.has(key)))return invalid();
  const result:Record<string,unknown>={...recordBase(definition.base,record)};
  for(const field of definition.fields)result[field.id]=parseField(field,values[field.id]);
  return Object.freeze(result);
}

export function getProjectActionInitialValues(definition:ActionFormDefinition,record?:EntityRecordDto):Readonly<Record<string,ActionFormValue>>{
  const result:Record<string,ActionFormValue>={};
  for(const field of definition.fields){const source=field.sourceField&&record?record.values[field.sourceField]:undefined;result[field.id]=source===null||source===undefined?(field.initial??(field.type==='boolean'?false:'')):field.type==='boolean'?Boolean(source):String(source);}
  return Object.freeze(result);
}
