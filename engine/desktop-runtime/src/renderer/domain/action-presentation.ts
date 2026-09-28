import type { DomainActionDto, EntityRecordDto } from '../../shared/dto';
import { getProjectActionForm, type ActionScope } from './project-action-forms';

export const legacyDomainActionIds = Object.freeze([
  'asset.change_status','asset.work_order.create','asset.inspection.plan.create','asset.inspection.task.create',
  'inspection.assign','inspection.start','inspection.record','inspection.submit','inspection.reject','inspection.archive',
  'work_order.dispatch','work_order.accept','work_order.add_processing_record','work_order.submit_resolution',
  'work_order.reject_review','work_order.approve_close'
]);
const legacyIds = new Set(legacyDomainActionIds);

export function actionFormStateKey(entityId:string,scope:ActionScope,record?:EntityRecordDto):string{
  return scope==='module'?`module:${entityId}`:`record:${entityId}:${record?.id??'none'}:${record?.version??'none'}`;
}

export function selectPresentableActions(
  actions:readonly DomainActionDto[], entityId:string, scope:ActionScope, record?:EntityRecordDto
):readonly DomainActionDto[]{
  if(scope==='record'&&!record)return Object.freeze([]);
  return Object.freeze(actions.filter((action)=>{
    if(action.entityId!==entityId||action.scope!==scope)return false;
    const project=getProjectActionForm(action.id);
    if(project)return project.scope===scope;
    return scope==='record'&&legacyIds.has(action.id);
  }));
}
