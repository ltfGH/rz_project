# 项目与任务领域包

`project_task@1.0.0` 提供项目、里程碑、加权任务、风险、多版本交付物和只追加项目事件，能力 ID 为 `project.core`。核心包可独立运行，不内置预算、工时、排班、实际文件存储或审批引擎。

## 核心规则

- 六个实体全部禁止通用写入，业务变化只能通过 `ProjectService`。
- 任务流程为 `pending -> in_progress -> pending_review -> completed`，驳回返回执行中；取消任务可恢复到待开始。
- 项目进度为已完成任务权重除以全部未取消任务权重，保留两位小数；无有效任务时为 0。
- 任务创建、权重修改、完成、取消和恢复与项目进度、版本、事件、审计在同一 SQLite 事务保存。
- 里程碑完成要求其必需任务完成，且每条必需交付链的最新版本已验收。
- 交付版本内容提交后不可修改，只能从 `submitted` 复核一次为 `accepted` 或 `rejected`；驳回后新增业务版本。
- 高风险必须缓解并由复核人关闭；未关闭中低风险必须存在处置说明。

## 项目关闭

项目流程为 `planning -> active -> pending_close -> closed`，驳回关闭申请后返回 `active`。申请关闭前校验里程碑、必需任务、最新交付版本、风险和全部只读扩展阻断器。最终关闭由不同于申请人的 `project_reviewer` 完成。关闭后所有领域对象只读。

阻断器只获得冻结的参数化 `find(entityId, filters)` 查询接口，不获得 SQLite `prepare`、`exec` 或其他写能力。

## 角色

- `project_member`：执行本人任务、登记和处置风险、提交交付版本。
- `project_manager`：管理本人项目、里程碑和任务，验收任务/交付物并申请关闭。
- `project_reviewer`：关闭风险、复核交付物、驳回或批准项目关闭。
- `project_admin`：维护计划中项目基础信息并查看全部项目。

## 种子与扩展

`generateProjectSeed({ seed, projectCount, tasksPerProject })` 使用固定时钟和 xorshift32，覆盖四种项目状态、任务驳回重做、取消任务、三类风险及多版本交付物。项目进度和事件终态与生成记录一致，不包含真实企业或个人身份。

核心包公开项目、任务、风险和交付物的字段/关系扩展点，以及项目/任务页签和创建来源。工单关联、库存领料、实际文件归档和立项审批应由显式依赖 `project.core` 的桥接包完成，不得绕过 `ProjectService` 修改状态或进度。

## 验证

从 `engine/domain-packs` 执行：

```powershell
npm run typecheck
npm test
npm run build
```

生产验收通过真实插件注册路径和 SQLite 完整执行任务驳回重做、交付版本替换、风险关闭、里程碑完成和独立项目关闭。
