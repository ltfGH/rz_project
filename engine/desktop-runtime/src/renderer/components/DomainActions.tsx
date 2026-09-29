import { useMemo, useState } from 'react';
import type { DomainActionDto, EntityRecordDto } from '../../shared/dto';
import { selectPresentableActions } from '../domain/action-presentation';
import { buildApplicationActionInput, getApplicationActionForm, getApplicationActionInitialValues } from '../domain/application-action-forms';
import { buildInventoryActionInput, getInventoryActionForm, getInventoryActionInitialValues } from '../domain/inventory-action-forms';
import {
  buildProjectActionInput, getProjectActionForm, getProjectActionInitialValues,
  type ActionFormValue, type ActionScope
} from '../domain/project-action-forms';
import { unwrap } from '../utils';

interface LegacyField {readonly id:string;readonly label:string;readonly type?:'text'|'number'|'datetime'|'select';readonly options?:readonly string[];readonly initial?:string;readonly required?:boolean}
const LABELS:Readonly<Record<string,string>>={
  'asset.change_status':'变更状态','asset.work_order.create':'创建工单','asset.inspection.plan.create':'创建巡检计划','asset.inspection.task.create':'创建巡检任务',
  'inspection.assign':'调整执行人','inspection.start':'开始巡检','inspection.record':'记录检查结果','inspection.submit':'提交复核','inspection.reject':'驳回巡检','inspection.archive':'归档巡检',
  'work_order.dispatch':'分派工单','work_order.accept':'受理工单','work_order.add_processing_record':'填写处理记录','work_order.submit_resolution':'提交解决','work_order.reject_review':'驳回返工','work_order.approve_close':'复核关闭'
};
const LEGACY_FIELDS:Readonly<Record<string,readonly LegacyField[]>>={
  'asset.change_status':[{id:'nextStatus',label:'目标状态',type:'select',options:['active','maintenance','inactive']},{id:'reason',label:'变更原因'}],
  'asset.work_order.create':[{id:'title',label:'工单标题'},{id:'description',label:'问题描述'},{id:'serviceCode',label:'服务编码',initial:'SVC-RECTIFICATION'},{id:'priority',label:'优先级',type:'select',options:['low','normal','high','urgent'],initial:'normal'}],
  'asset.inspection.plan.create':[{id:'name',label:'计划名称'},{id:'cycleDays',label:'周期天数',type:'number',initial:'1'},{id:'instructions',label:'执行说明'}],
  'asset.inspection.task.create':[{id:'title',label:'任务标题'},{id:'executorId',label:'执行账号',initial:'operator'},{id:'scheduledAt',label:'计划时间',type:'datetime'},{id:'itemName',label:'检查项'},{id:'itemStandard',label:'检查标准'}],
  'inspection.assign':[{id:'executorId',label:'执行账号',initial:'operator'},{id:'reason',label:'调整原因'}],
  'inspection.record':[{id:'itemId',label:'检查项 ID',type:'number'},{id:'result',label:'检查结果',type:'select',options:['normal','abnormal'],initial:'normal'},{id:'finding',label:'异常描述'},{id:'disposition',label:'处置说明'}],
  'inspection.reject':[{id:'reason',label:'驳回原因'}],'inspection.archive':[{id:'comment',label:'归档说明'}],
  'work_order.dispatch':[{id:'handlerId',label:'处理账号',initial:'operator'},{id:'reason',label:'分派说明'}],
  'work_order.add_processing_record':[{id:'content',label:'处理记录'}],'work_order.submit_resolution':[{id:'resolution',label:'解决说明'}],
  'work_order.reject_review':[{id:'reason',label:'驳回原因'}],'work_order.approve_close':[{id:'comment',label:'复核说明'}]
};
function fixedForm(id:string){return getProjectActionForm(id)??getApplicationActionForm(id)??getInventoryActionForm(id);}
function fixedInitial(id:string,record?:EntityRecordDto):Readonly<Record<string,ActionFormValue>>|undefined{
  const project=getProjectActionForm(id);if(project)return getProjectActionInitialValues(project,record);
  const application=getApplicationActionForm(id);if(application)return getApplicationActionInitialValues(application,record);
  const inventory=getInventoryActionForm(id);if(inventory)return getInventoryActionInitialValues(inventory,record);
}
function fixedInput(id:string,values:Readonly<Record<string,unknown>>,record?:EntityRecordDto):Readonly<Record<string,unknown>>|undefined{
  const project=getProjectActionForm(id);if(project)return buildProjectActionInput(project,values,record);
  const application=getApplicationActionForm(id);if(application)return buildApplicationActionInput(application,values,record);
  const inventory=getInventoryActionForm(id);if(inventory)return buildInventoryActionInput(inventory,values,record);
}

function legacyBase(id:string,record:EntityRecordDto):Record<string,unknown>{
  if(id.startsWith('work_order.'))return{workOrderId:record.id,expectedVersion:record.version};
  if(id.startsWith('inspection.'))return{taskId:record.id,expectedTaskVersion:record.version};
  if(id==='asset.change_status')return{assetId:record.id,expectedVersion:record.version};
  if(id==='asset.work_order.create'||id==='asset.inspection.plan.create')return{assetId:record.id};
  if(id==='asset.inspection.task.create')return{planCode:String(record.values.code)};
  return{};
}
function legacyInput(actionId:string,values:Readonly<Record<string,ActionFormValue>>,record?:EntityRecordDto):Readonly<Record<string,unknown>>{
  if(!record)throw new Error('Action record is required.');const input:Record<string,unknown>={...legacyBase(actionId,record)};
  for(const field of LEGACY_FIELDS[actionId]??[]){const value=values[field.id];input[field.id]=field.type==='number'?Number(value):field.type==='datetime'?new Date(String(value)).toISOString():value;}
  if(actionId==='asset.inspection.plan.create')input.active=true;
  if(actionId==='asset.inspection.task.create'){input.items=[{name:input.itemName,standard:input.itemStandard}];delete input.itemName;delete input.itemStandard;}
  if(actionId==='inspection.record'&&input.result==='normal'){input.finding=null;input.disposition=null;}
  return input;
}

export function DomainActions({token,entityId,record,scope,actions,onComplete}:{
  token:string;entityId:string;record?:EntityRecordDto;scope:ActionScope;
  actions:readonly DomainActionDto[];onComplete:()=>void;
}){
  const available=useMemo(()=>selectPresentableActions(actions,entityId,scope,record),[actions,entityId,scope,record]);
  const[selected,setSelected]=useState<DomainActionDto|null>(null);
  const[values,setValues]=useState<Record<string,ActionFormValue>>({});
  const[error,setError]=useState('');
  if(available.length===0)return null;
  function choose(action:DomainActionDto){
    const initial=fixedInitial(action.id,record)??Object.fromEntries((LEGACY_FIELDS[action.id]??[]).map(field=>[field.id,field.initial??'']));
    setSelected(action);setValues({...initial});setError('');
  }
  async function run(){
    if(!selected)return;
    try{
      const input=fixedInput(selected.id,values,record)??legacyInput(selected.id,values,record);
      unwrap(await window.businessApi.domain.execute(token,selected.id,input));
      setSelected(null);setValues({});onComplete();
    }catch{setError('操作未完成，请检查输入和当前状态');}
  }
  const definition=selected?fixedForm(selected.id):undefined;
  const renderedFields=definition?.fields??(selected?LEGACY_FIELDS[selected.id]??[]:[]);
  const title=definition?.label??(selected?LABELS[selected.id]??selected.label:'');
  return <section className="domain-actions" aria-label={scope==='module'?'模块操作':'领域操作'}>
    <div className="action-row">{available.map(action=><button key={action.id} className="secondary-button" onClick={()=>choose(action)}>{fixedForm(action.id)?.label??LABELS[action.id]??action.label}</button>)}</div>
    {selected&&<form onSubmit={event=>{event.preventDefault();void run();}}>
      <h4>{title}</h4>
      {renderedFields.map(field=><label key={field.id}>{field.label}
        {field.type==='select'?<select value={String(values[field.id]??'')} onChange={event=>setValues({...values,[field.id]:event.target.value})}>{field.options?.map(option=><option key={option}>{option}</option>)}</select>
          :field.type==='boolean'?<input type="checkbox" checked={Boolean(values[field.id])} onChange={event=>setValues({...values,[field.id]:event.target.checked})}/>
          :<input type={field.type==='number'?'number':field.type==='datetime'?'datetime-local':field.type==='date'?'date':'text'} value={String(values[field.id]??'')} onChange={event=>setValues({...values,[field.id]:event.target.value})} required={field.required!==false}/>}</label>)}
      {renderedFields.length===0&&<p>确认执行此操作。</p>}
      {error&&<p className="error-text">{error}</p>}
      <div className="action-row"><button className="primary-button" type="submit">确认</button><button className="secondary-button" type="button" onClick={()=>setSelected(null)}>取消</button></div>
    </form>}
  </section>;
}
