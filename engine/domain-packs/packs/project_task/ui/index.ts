const extensions=Object.freeze([
 Object.freeze({id:'project.milestones.tab',slot:'entity.detail.tabs',entityId:'project',label:'里程碑',order:20,viewId:'project_milestones'}),
 Object.freeze({id:'project.tasks.tab',slot:'entity.detail.tabs',entityId:'project',label:'项目任务',order:30,viewId:'project_tasks'}),
 Object.freeze({id:'project.risks.tab',slot:'entity.detail.tabs',entityId:'project',label:'项目风险',order:40,viewId:'project_risks'}),
 Object.freeze({id:'project.deliverables.tab',slot:'entity.detail.tabs',entityId:'project',label:'交付版本',order:50,viewId:'project_deliverables'}),
 Object.freeze({id:'project.events.tab',slot:'entity.detail.tabs',entityId:'project',label:'项目事件',order:60,viewId:'project_events'}),
 Object.freeze({id:'project.lifecycle.actions',slot:'entity.detail.actions',entityId:'project',label:'项目操作',order:10,actionIds:Object.freeze(['project.activate','project.request_close','project.reject_close','project.approve_close'])}),
 Object.freeze({id:'project.task.actions',slot:'entity.detail.actions',entityId:'project_task',label:'任务操作',order:10,actionIds:Object.freeze(['project.task.start','project.task.progress','project.task.submit','project.task.reject','project.task.approve','project.task.cancel','project.task.restore'])}),
 Object.freeze({id:'project.dashboard',slot:'dashboard.sections',label:'项目概览',order:20,viewId:'project_dashboard',dataSource:'project.dashboard_summary'})
]);
export const projectUiDescriptor=Object.freeze({id:'project_task',version:'1.0.0',slots:Object.freeze(['entity.detail.tabs','entity.detail.actions','dashboard.sections']as const),extensions});
