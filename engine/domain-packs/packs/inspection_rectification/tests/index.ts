import type { DatabaseSync } from 'node:sqlite'; import type { RuntimeDatabase } from '../../../../desktop-runtime/src/core/database'; import type { DashboardService } from '../../../../desktop-runtime/src/core/dashboard-service'; import type { EntityRepository } from '../../../../desktop-runtime/src/core/entity-repository'; import type { ActorDto } from '../../../../desktop-runtime/src/shared/dto'; import type { InspectionContext } from '../runtime/types'; import type { InspectionService } from '../runtime/inspection-service';
export interface InspectionAcceptanceDependencies { database:RuntimeDatabase; repository:EntityRepository; service:InspectionService; dashboard:DashboardService; actors:Record<string,ActorDto>; context:(connection:DatabaseSync,actor:ActorDto)=>InspectionContext }
export function runInspectionAcceptanceScenario(d:InspectionAcceptanceDependencies) {
  const {database,service,actors}=d; const planner=actors.planner!; const executor=actors.executor!; const reviewer=actors.reviewer!;
  const plan=database.transaction(c=>service.createPlan({name:'验收计划',cycleDays:7,instructions:'逐项执行',active:true},d.context(c,actors.admin!)));
  const task=database.transaction(c=>service.createTask({planCode:plan.planCode,title:'验收任务',executorId:executor.username,scheduledAt:'2026-09-19T08:00:00.000Z',items:[{name:'项目一',standard:'正常'},{name:'项目二',standard:'正常'}]},d.context(c,planner)));
  let current=database.transaction(c=>service.startTask({taskId:task.taskId,expectedTaskVersion:1},d.context(c,executor)));
  let item=database.transaction(c=>service.recordItemResult({taskId:task.taskId,itemId:task.itemIds[0]!,expectedTaskVersion:current.version,expectedItemVersion:1,result:'normal',finding:null,disposition:null},d.context(c,executor)));
  item=database.transaction(c=>service.recordItemResult({taskId:task.taskId,itemId:task.itemIds[1]!,expectedTaskVersion:item.taskVersion,expectedItemVersion:1,result:'abnormal',finding:'异常',disposition:'处置'},d.context(c,executor)));
  let review=database.transaction(c=>service.submitReview({taskId:task.taskId,expectedTaskVersion:item.taskVersion},d.context(c,executor)));
  current=database.transaction(c=>service.rejectReview({taskId:task.taskId,expectedTaskVersion:review.version,reason:'复测'},d.context(c,reviewer)));
  item=database.transaction(c=>service.recordItemResult({taskId:task.taskId,itemId:task.itemIds[1]!,expectedTaskVersion:current.version,expectedItemVersion:2,result:'normal',finding:null,disposition:null},d.context(c,executor)));
  review=database.transaction(c=>service.submitReview({taskId:task.taskId,expectedTaskVersion:item.taskVersion},d.context(c,executor)));
  const archived=database.transaction(c=>service.archiveTask({taskId:task.taskId,expectedTaskVersion:review.version,comment:'通过'},d.context(c,reviewer)));
  const summary=service.readTaskSummary(task.taskId,d.context(database as unknown as DatabaseSync,planner)); const eventCount=database.prepare('SELECT COUNT(*) AS count FROM biz_inspection_event WHERE task_code = ?').get(task.taskCode) as {count:number}; const auditCount=database.prepare('SELECT COUNT(*) AS count FROM sys_audit_event').get() as {count:number};
  return Object.freeze({status:archived.status,version:archived.version,eventCount:Number(eventCount.count),auditCount:Number(auditCount.count),total:summary.total,abnormal:summary.abnormal});
}
export const inspectionAcceptanceDescriptor=Object.freeze({id:'inspection_rectification',version:'1.0.0',scenarios:Object.freeze(['inspection.lifecycle.acceptance'])});
