const extensions = Object.freeze([
  Object.freeze({ id:'inspection.items.tab', slot:'entity.detail.tabs', entityId:'inspection_task', label:'检查项', order:20, viewId:'inspection_items' }),
  Object.freeze({ id:'inspection.anomalies.tab', slot:'entity.detail.tabs', entityId:'inspection_task', label:'异常处置', order:30, viewId:'inspection_anomalies' }),
  Object.freeze({ id:'inspection.history.tab', slot:'entity.detail.tabs', entityId:'inspection_task', label:'流转历史', order:40, viewId:'inspection_history' }),
  Object.freeze({ id:'inspection.lifecycle.actions', slot:'entity.detail.actions', entityId:'inspection_task', label:'巡检操作', order:10, actionIds:Object.freeze(['inspection.assign','inspection.start','inspection.record','inspection.submit','inspection.reject','inspection.archive']) }),
  Object.freeze({ id:'inspection.plan.actions', slot:'entity.detail.actions', entityId:'inspection_plan', label:'计划操作', order:10, actionIds:Object.freeze(['inspection.plan.create','inspection.plan.update']) }),
  Object.freeze({ id:'inspection.dashboard', slot:'dashboard.sections', label:'巡检概览', order:20, viewId:'inspection_dashboard', dataSource:'inspection.dashboard_summary', presentation:Object.freeze({groups:Object.freeze([
    Object.freeze({id:'inspection_status',label:'巡检状态',kind:'status',items:Object.freeze([
      Object.freeze({id:'pending',sourceKey:'pending',label:'待执行',tone:'neutral',moduleId:'inspection_tasks'}),Object.freeze({id:'executing',sourceKey:'executing',label:'执行中',tone:'teal',moduleId:'inspection_tasks'}),Object.freeze({id:'pending_review',sourceKey:'pendingReview',label:'待复核',tone:'amber',moduleId:'inspection_tasks'}),Object.freeze({id:'archived',sourceKey:'archived',label:'已归档',tone:'neutral',moduleId:'inspection_tasks'})
    ])}),
    Object.freeze({id:'inspection_attention',label:'需要关注',kind:'attention',items:Object.freeze([
      Object.freeze({id:'pending_reviews',sourceKey:'pendingReview',label:'待复核任务',tone:'amber',moduleId:'inspection_tasks'}),Object.freeze({id:'abnormal_items',sourceKey:'abnormalItems',label:'异常检查项',tone:'red',moduleId:'inspection_items'})
    ])})
  ])}) })
]);
export const inspectionUiDescriptor = Object.freeze({ id:'inspection_rectification', version:'1.0.0', slots:Object.freeze(['entity.detail.tabs','entity.detail.actions','dashboard.sections'] as const), extensions });
