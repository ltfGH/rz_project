import type { EntityRecordDto } from '../../shared/dto';
import type { ActionFieldDefinition, ActionFormValue, ActionScope } from './project-action-forms';

type BaseKind = 'none' | 'application' | 'application-decision' | 'certificate' | 'reminder';
export interface ApplicationActionFormDefinition {
  readonly id:string; readonly label:string; readonly entityId:string; readonly scope:ActionScope;
  readonly fields:readonly ActionFieldDefinition[]; readonly base:BaseKind;
}

const text=(id:string,label:string,options:Partial<ActionFieldDefinition>={}):ActionFieldDefinition=>Object.freeze({id,label,type:'text',required:true,...options});
const number=(id:string,label:string):ActionFieldDefinition=>Object.freeze({id,label,type:'number',required:true});
const date=(id:string,label:string,required=true):ActionFieldDefinition=>Object.freeze({id,label,type:'date',required});
const fields=(...items:ActionFieldDefinition[])=>Object.freeze(items);
const definition=(id:string,label:string,entityId:string,scope:ActionScope,base:BaseKind,items:readonly ActionFieldDefinition[]):ApplicationActionFormDefinition=>Object.freeze({id,label,entityId,scope,base,fields:items});

const applicationFields=fields(
  text('applicationType','申请类型',{sourceField:'application_type'}),
  text('title','申请标题',{sourceField:'title'}),
  text('content','申请正文',{sourceField:'content'})
);
const certificateFields=fields(
  text('certificateKey','证照业务键'),text('businessVersion','业务版本'),text('name','证照名称'),
  text('certificateNo','证照编号'),date('issuedAt','签发日期'),date('expiresAt','到期日期',false),
  text('fileVersionCode','文件版本编码',{required:false})
);
const renewalFields=certificateFields.filter((field)=>field.id!=='certificateKey');

const definitions=Object.freeze([
  definition('application.create','创建申请','application','module','none',applicationFields),
  definition('application.certificate.create','创建证照','certificate','module','none',certificateFields),
  definition('application.update','修改申请','application','record','application',applicationFields),
  definition('application.submit','提交申请','application','record','application',fields(text('comment','提交说明'))),
  definition('application.approve','批准当前节点','application','record','application-decision',fields(number('nodeId','审批节点 ID'),number('expectedNodeVersion','节点版本'),text('comment','审批意见'))),
  definition('application.reject','驳回当前节点','application','record','application-decision',fields(number('nodeId','审批节点 ID'),number('expectedNodeVersion','节点版本'),text('reason','驳回原因'))),
  definition('application.withdraw','撤回申请','application','record','application',fields(text('reason','撤回原因'))),
  definition('application.revise','重新修订','application','record','application',fields(text('reason','修订说明'))),
  definition('application.archive','归档申请','application','record','application',fields(text('fileVersionCode','归档文件版本编码'),text('comment','归档说明'))),
  definition('application.certificate.renew','续期证照','certificate','record','certificate',renewalFields),
  definition('application.certificate.refresh_reminders','刷新到期提醒','certificate','module','none',fields(date('today','业务日期'))),
  definition('application.reminder.acknowledge','确认到期提醒','expiry_reminder','record','reminder',fields())
]);

const byId=new Map(definitions.map((item)=>[item.id,item]));
export const applicationActionFormIds=Object.freeze(definitions.map((item)=>item.id));
export function getApplicationActionForm(actionId:string):ApplicationActionFormDefinition|undefined{return byId.get(actionId);}

function invalid():never{throw new Error('Invalid application action form input.');}
function missingRecord():never{throw new Error('Application action record is required.');}
function validDate(value:string):string{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return invalid();const parsed=new Date(`${value}T00:00:00.000Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)return invalid();return value;}
function parse(field:ActionFieldDefinition,value:unknown):unknown{
  if(typeof value!=='string')return invalid();const normalized=value.trim();
  if(!normalized){if(!field.required)return null;return invalid();}
  if(field.type==='number'){const parsed=Number(normalized);if(!Number.isSafeInteger(parsed)||parsed<=0)return invalid();return parsed;}
  if(field.type==='date')return validDate(normalized);
  return normalized;
}
function base(kind:BaseKind,record?:EntityRecordDto):Record<string,unknown>{
  if(kind==='none')return{};if(!record)return missingRecord();
  if(kind==='application')return{applicationId:record.id,expectedVersion:record.version};
  if(kind==='application-decision')return{applicationId:record.id,expectedApplicationVersion:record.version};
  if(kind==='certificate')return{previousCertificateId:record.id,expectedPreviousVersion:record.version};
  return{reminderId:record.id,expectedVersion:record.version};
}
export function buildApplicationActionInput(definition:ApplicationActionFormDefinition,values:Readonly<Record<string,unknown>>,record?:EntityRecordDto):Readonly<Record<string,unknown>>{
  const allowed=new Set(definition.fields.map((field)=>field.id));if(Object.keys(values).some((key)=>!allowed.has(key)))return invalid();
  const result:Record<string,unknown>={...base(definition.base,record)};for(const field of definition.fields)result[field.id]=parse(field,values[field.id]);return Object.freeze(result);
}
export function getApplicationActionInitialValues(definition:ApplicationActionFormDefinition,record?:EntityRecordDto):Readonly<Record<string,ActionFormValue>>{
  const result:Record<string,ActionFormValue>={};for(const field of definition.fields){const source=field.sourceField&&record?record.values[field.sourceField]:undefined;result[field.id]=source===null||source===undefined?(field.initial??''):String(source);}return Object.freeze(result);
}
