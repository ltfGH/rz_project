import type { EntityRecordDto } from '../../shared/dto';
import type { ActionFieldDefinition, ActionFormValue, ActionScope } from './project-action-forms';

type BaseKind='none'|'material'|'warehouse'|'batch'|'batch-code';
export interface InventoryActionFormDefinition{
  readonly id:string;readonly label:string;readonly entityId:string;readonly scope:ActionScope;
  readonly fields:readonly ActionFieldDefinition[];readonly base:BaseKind;
}
const text=(id:string,label:string,options:Partial<ActionFieldDefinition>={}):ActionFieldDefinition=>Object.freeze({id,label,type:'text',required:true,...options});
const number=(id:string,label:string,options:Partial<ActionFieldDefinition>={}):ActionFieldDefinition=>Object.freeze({id,label,type:'number',required:true,...options});
const date=(id:string,label:string,required=true):ActionFieldDefinition=>Object.freeze({id,label,type:'date',required});
const boolean=(id:string,label:string,sourceField?:string):ActionFieldDefinition=>Object.freeze({id,label,type:'boolean',required:true,initial:true,...(sourceField?{sourceField}:{})});
const select=(id:string,label:string,options:string[]):ActionFieldDefinition=>Object.freeze({id,label,type:'select',required:true,options:Object.freeze(options)});
const fields=(...items:ActionFieldDefinition[])=>Object.freeze(items);
const definition=(id:string,label:string,entityId:string,scope:ActionScope,base:BaseKind,items:readonly ActionFieldDefinition[]):InventoryActionFormDefinition=>Object.freeze({id,label,entityId,scope,base,fields:items});
const materialFields=fields(text('name','物料名称',{sourceField:'name'}),text('unit','计量单位',{sourceField:'unit'}),number('expiryWarningDays','效期预警天数',{sourceField:'expiry_warning_days'}),boolean('active','启用','active'));
const warehouseFields=fields(text('name','仓库名称',{sourceField:'name'}),boolean('active','启用','active'));
const movementFields=fields(number('quantity','数量'),text('reason','业务说明'));
const definitions=Object.freeze([
  definition('inventory.material.create','创建物料','material','module','none',materialFields),
  definition('inventory.warehouse.create','创建仓库','warehouse','module','none',warehouseFields),
  definition('inventory.batch.receive_new','新批次入库','inventory_batch','module','none',fields(text('materialCode','物料编码'),text('warehouseCode','仓库编码'),text('batchNo','批次号'),number('quantity','入库数量'),date('producedAt','生产日期',false),date('receivedAt','入库日期'),date('expiresAt','到期日期',false),text('reason','入库说明'))),
  definition('inventory.material.update','修改物料','material','record','material',materialFields),
  definition('inventory.warehouse.update','修改仓库','warehouse','record','warehouse',warehouseFields),
  definition('inventory.batch.receive_existing','已有批次入库','inventory_batch','record','batch',movementFields),
  definition('inventory.batch.issue','领用出库','inventory_batch','record','batch',movementFields),
  definition('inventory.batch.return','领用退库','inventory_batch','record','batch',fields(...movementFields,number('issueTransactionId','原领用流水 ID'))),
  definition('inventory.batch.adjust','库存调整','inventory_batch','record','batch',fields(...movementFields,select('direction','调整方向',['in','out']))),
  definition('inventory.application.create','发起库存申领','inventory_batch','record','batch-code',fields(number('quantity','申领数量'),text('purpose','申领用途'),text('title','申请标题'),text('content','申请正文')))
]);
const byId=new Map(definitions.map((item)=>[item.id,item]));
export const inventoryActionFormIds=Object.freeze(definitions.map((item)=>item.id));
export function getInventoryActionForm(actionId:string):InventoryActionFormDefinition|undefined{return byId.get(actionId);}
function invalid():never{throw new Error('Invalid inventory action form input.');}
function missingRecord():never{throw new Error('Inventory action record is required.');}
function validDate(value:string):string{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return invalid();const parsed=new Date(`${value}T00:00:00.000Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)return invalid();return value;}
function parse(field:ActionFieldDefinition,value:unknown):unknown{
  if(field.type==='boolean'){if(value===true||value==='true')return true;if(value===false||value==='false')return false;return invalid();}
  if(typeof value!=='string')return invalid();const normalized=value.trim();if(!normalized){if(!field.required)return null;return invalid();}
  if(field.type==='number'){const parsed=Number(normalized);if(!Number.isFinite(parsed)||parsed<0||(field.id!=='expiryWarningDays'&&parsed===0))return invalid();return parsed;}
  if(field.type==='date')return validDate(normalized);if(field.type==='select'&&!field.options?.includes(normalized))return invalid();return normalized;
}
function base(kind:BaseKind,record?:EntityRecordDto):Record<string,unknown>{
  if(kind==='none')return{};if(!record)return missingRecord();
  if(kind==='batch-code'){const code=record.values.code;if(typeof code!=='string'||!code.trim())return missingRecord();return{batchCode:code};}
  const names={material:'materialId',warehouse:'warehouseId',batch:'batchId'}as const;return{[names[kind]]:record.id,expectedVersion:record.version};
}
export function buildInventoryActionInput(definition:InventoryActionFormDefinition,values:Readonly<Record<string,unknown>>,record?:EntityRecordDto):Readonly<Record<string,unknown>>{
  const allowed=new Set(definition.fields.map((field)=>field.id));if(Object.keys(values).some((key)=>!allowed.has(key)))return invalid();const result:Record<string,unknown>={...base(definition.base,record)};for(const field of definition.fields)result[field.id]=parse(field,values[field.id]);return Object.freeze(result);
}
export function getInventoryActionInitialValues(definition:InventoryActionFormDefinition,record?:EntityRecordDto):Readonly<Record<string,ActionFormValue>>{
  const result:Record<string,ActionFormValue>={};for(const field of definition.fields){const source=field.sourceField&&record?record.values[field.sourceField]:undefined;result[field.id]=source===null||source===undefined?(field.initial??(field.type==='boolean'?false:'')):field.type==='boolean'?Boolean(source):String(source);}return Object.freeze(result);
}
