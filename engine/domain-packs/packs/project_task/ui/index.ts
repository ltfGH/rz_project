const extensions=Object.freeze([
 Object.freeze({id:'project.milestones.tab',slot:'entity.detail.tabs',entityId:'project',label:'里程碑',order:20,viewId:'project_milestones'}),
 Object.freeze({id:'project.tasks.tab',slot:'entity.detail.tabs',entityId:'project',label:'项目任务',order:30,viewId:'project_tasks'}),
 Object.freeze({id:'project.risks.tab',slot:'entity.detail.tabs',entityId:'project',label:'项目风险',order:40,viewId:'project_risks'}),
 Object.freeze({id:'project.deliverables.tab',slot:'entity.detail.tabs',entityId:'project',label:'交付版本',order:50,viewId:'project_deliverables'}),
 Object.freeze({id:'project.events.tab',slot:'entity.detail.tabs',entityId:'project',label:'项目事件',order:60,viewId:'project_events'}),
 Object.freeze({id:'project.task.events.tab',slot:'entity.detail.tabs',entityId:'project_task',label:'任务事件',order:20,viewId:'project_task_events'}),
 Object.freeze({id:'project.module.actions',slot:'entity.module.actions',entityId:'project',label:'项目操作',order:10,actionIds:Object.freeze(['project.create'])}),
 Object.freeze({id:'project.lifecycle.actions',slot:'entity.detail.actions',entityId:'project',label:'项目操作',order:10,actionIds:Object.freeze(['project.update','project.activate','project.request_close','project.reject_close','project.approve_close','project.milestone.create','project.task.create','project.risk.create','project.deliverable.submit'])}),
 Object.freeze({id:'project.milestone.actions',slot:'entity.detail.actions',entityId:'milestone',label:'里程碑操作',order:10,actionIds:Object.freeze(['project.milestone.complete'])}),
 Object.freeze({id:'project.task.actions',slot:'entity.detail.actions',entityId:'project_task',label:'任务操作',order:10,actionIds:Object.freeze(['project.task.update','project.task.start','project.task.progress','project.task.submit','project.task.reject','project.task.approve','project.task.cancel','project.task.restore'])}),
 Object.freeze({id:'project.risk.actions',slot:'entity.detail.actions',entityId:'project_risk',label:'风险操作',order:10,actionIds:Object.freeze(['project.risk.mitigate','project.risk.close','project.risk.reopen'])}),
 Object.freeze({id:'project.deliverable.actions',slot:'entity.detail.actions',entityId:'deliverable',label:'交付复核',order:10,actionIds:Object.freeze(['project.deliverable.review'])}),
 Object.freeze({id:'project.dashboard',slot:'dashboard.sections',label:'项目概览',order:20,viewId:'project_dashboard',dataSource:'project.dashboard_summary',presentation:Object.freeze({groups:Object.freeze([
  Object.freeze({id:'project_status',label:'项目状态',kind:'status',items:Object.freeze([
   Object.freeze({id:'planning',sourceKey:'planning',label:'规划中',tone:'neutral',moduleId:'projects'}),Object.freeze({id:'active',sourceKey:'active',label:'进行中',tone:'teal',moduleId:'projects'}),Object.freeze({id:'pending_close',sourceKey:'pendingClose',label:'待关闭复核',tone:'amber',moduleId:'projects'}),Object.freeze({id:'closed',sourceKey:'closed',label:'已关闭',tone:'neutral',moduleId:'projects'})
  ])}),
  Object.freeze({id:'project_attention',label:'需要关注',kind:'attention',items:Object.freeze([
   Object.freeze({id:'overdue_projects',sourceKey:'overdueProjects',label:'逾期项目',tone:'red',moduleId:'projects'}),Object.freeze({id:'overdue_milestones',sourceKey:'overdueMilestones',label:'逾期里程碑',tone:'red',moduleId:'milestones'}),Object.freeze({id:'pending_task_reviews',sourceKey:'pendingTaskReviews',label:'待验收任务',tone:'amber',moduleId:'project_tasks'}),Object.freeze({id:'open_high_risks',sourceKey:'openHighRisks',label:'开放高风险',tone:'red',moduleId:'project_risks'}),Object.freeze({id:'submitted_deliverables',sourceKey:'submittedDeliverables',label:'待验收交付物',tone:'amber',moduleId:'deliverables'})
  ])})
 ])})})
]);
export const projectUiDescriptor=Object.freeze({id:'project_task',version:'1.0.0',slots:Object.freeze(['entity.detail.tabs','entity.module.actions','entity.detail.actions','dashboard.sections']as const),extensions});
