# 巡检与整改领域包设计

## 1. 目标

实现生产级 `inspection_rectification@1.0.0` 领域包，为离线业务软件提供巡检计划、任务执行、检查项结果、异常处置、复核归档和只追加历史。核心包可独立使用，不强制依赖资产台账或工单；资产关系和整改工单闭环由后续桥接包组合。

本包兼容业务蓝图 `1.0` 和桌面运行时 `1.0.0`，提供能力 `inspection.core`。

## 2. 范围与边界

本包负责：

- 巡检计划模板及启停管理；
- 从计划创建带检查项的实际巡检任务；
- 执行人分派、开始执行、逐项记录、提交复核、驳回返工和归档；
- 正常与异常结果、异常描述和离线处置说明；
- 每次领域操作的巡检事件与系统审计；
- 确定性离线演示数据；
- 受控详情页签、操作描述符和单包验收场景。

本包不负责：

- 资产实体、工单实体或云端设备数据采集；
- 自动排班、地理轨迹、实时定位或外部通知；
- 专业法规判定和行业强制检查标准自动生成；
- 动态脚本、任意 SQL 或模型生成后执行的业务代码；
- 绕过底座会话、权限、审计、事务和备份恢复机制。

## 3. 数据模型

### 3.1 `inspection_plan`

巡检计划模板由领域命令创建和更新，通用仓储只允许列表和查看。

- `code`：唯一稳定编码；
- `name`：计划名称；
- `cycle_days`：建议执行周期天数，必须为正整数；
- `instructions`：执行说明；
- `active`：是否可创建新任务。

被任务引用后受外键限制，不能硬删除。

创建和更新计划时校验 `cycle_days` 为正整数，并写入系统审计。

### 3.2 `inspection_task`

一次实际巡检任务，所有业务写入由领域服务控制。

- `code`：唯一稳定编码；
- `plan_code`：巡检计划引用；
- `title`：任务标题；
- `status`：当前状态；
- `executor_id`：执行人稳定身份标识；
- `scheduled_at`：计划执行时间；
- `started_at`、`submitted_at`、`archived_at`：实际业务节点时间，可为空。

任务状态、执行人和节点时间禁止通过通用仓储修改。

### 3.3 `inspection_item`

任务内检查项及其结果，系统管理，禁止通用创建和更新。

- `code`：唯一稳定编码；
- `task_code`：巡检任务引用；
- `name`：检查项名称；
- `standard`：检查标准；
- `result`：`pending`、`normal`、`abnormal`；
- `finding`：异常描述，可为空；
- `disposition`：离线处置说明，可为空；
- `checked_at`：完成检查时间，可为空。

同一任务内检查项名称不得重复。`normal` 结果清空异常字段；`abnormal` 结果必须同时提供非空 `finding` 和 `disposition`。

### 3.4 `inspection_event`

系统管理、只追加的任务事件历史。

- `code`：唯一事件编码；
- `task_code`：巡检任务引用；
- `event_type`：`created`、`assigned`、`started`、`item_recorded`、`submitted`、`review_rejected`、`archived`；
- `from_status`、`to_status`：状态变化前后值，可为空；
- `actor_id`：操作人稳定身份标识；
- `content`：操作原因或结果摘要；
- `occurred_at`：发生时间。

事件实体使用 `append_only`、`history: true`、`systemManaged: true`，不提供通用创建、更新或删除动作。

## 4. 状态机

状态为：

- `pending`：待执行；
- `executing`：执行中；
- `pending_review`：待复核；
- `archived`：已归档。

允许迁移：

| 命令 | 起始状态 | 目标状态 | 权限 |
| --- | --- | --- | --- |
| `assign_executor` | `pending` | `pending` | `inspection_tasks.assign` |
| `start_task` | `pending` | `executing` | `inspection_tasks.execute` |
| `submit_review` | `executing` | `pending_review` | `inspection_tasks.submit` |
| `reject_review` | `pending_review` | `executing` | `inspection_tasks.review` |
| `archive_task` | `pending_review` | `archived` | `inspection_tasks.review` |

`createTask` 创建 `pending` 任务和至少一个 `pending` 检查项；`recordItemResult` 不改变任务状态，但同时递增任务和检查项版本。

## 5. 领域规则

### 5.1 任务创建

创建任务必须：

1. 校验创建权限和计划人员身份；
2. 校验计划存在且启用；
3. 校验执行人存在且具有执行角色；
4. 校验任务标题、计划时间和检查项；
5. 检查项数量为 1–100，同任务名称去除首尾空白后不得重复；
6. 在同一事务内创建任务、全部检查项、`created` 事件和审计。

任一检查项写入或审计失败时，任务和所有检查项整体回滚。

### 5.2 分派与开始

- 调整执行人只允许在 `pending` 状态；
- 新执行人必须由调用方身份注册表确认存在且具有 `inspection_executor` 角色；
- 只有当前 `executor_id` 对应用户可以开始任务；
- 开始任务写入 `started_at` 并追加事件。

### 5.3 检查项结果

- 只有当前执行人可在 `executing` 状态记录结果；
- 请求同时携带任务和检查项期望版本；
- 检查项必须属于目标任务；
- `normal` 不接受异常描述和处置说明；
- `abnormal` 必须提供非空异常描述和处置说明；
- 成功写入检查项结果、`checked_at`、任务版本、`item_recorded` 事件和审计。

### 5.4 提交与复核

- 只有当前执行人可提交复核；
- 所有检查项 `result` 必须不为 `pending`；
- 所有异常项必须包含异常描述和处置说明；
- 提交写入 `submitted_at` 并进入 `pending_review`；
- 复核人必须具有 `inspection_reviewer` 角色，且身份不得与当前执行人相同；
- 驳回回到 `executing`，清空当前 `submitted_at`，保留全部历史事件；
- 归档写入 `archived_at`，归档后任务和检查项不可再修改。

### 5.5 归档阻断器

`InspectionContext.archiveBlockers` 接受桥接包注册的只读阻断器：

```text
(taskId, transaction) -> { blocked, code, message }
```

核心包在 `archiveTask` 中依次执行阻断器。任一阻断器返回 `blocked: true`，整个操作以 `INVALID_TRANSITION` 失败且不写数据。

巡检-工单桥接包用阻断器检查异常项关联的整改工单是否全部关闭。核心包独立使用时没有该桥接阻断器，但仍要求异常描述与离线处置说明完整。

### 5.6 权限、身份、状态与版本顺序

领域命令按以下顺序失败关闭：

1. 权限；
2. 读取目标记录；
3. 当前执行人或复核人身份；
4. 状态和领域条件；
5. 期望版本；
6. 带版本条件的 SQL 更新；
7. 事件与审计。

未经授权身份不能通过错误差异获知任务状态或版本。所有更新仍使用 `WHERE id = ? AND version = ?` 作为最终并发保护。

## 6. 角色与权限

### 6.1 `inspection_planner`

- 查看和维护巡检计划；
- 创建巡检任务；
- 在待执行状态调整执行人；
- 查看任务、检查项和事件。

### 6.2 `inspection_executor`

- 开始本人被派任务；
- 记录本人任务的检查项结果；
- 提交本人任务复核；
- 查看计划、任务、检查项和事件。

### 6.3 `inspection_reviewer`

- 驳回返工；
- 复核归档；
- 查看计划、任务、检查项和事件。

### 6.4 `inspection_admin`

- 查看和维护计划；
- 查看全部任务、检查项和事件；
- 不因管理员身份绕过执行人与复核人分离规则。

权限只表示允许尝试命令；运行时仍校验当前执行人、复核分离、状态、检查项完成度和版本。

## 7. 运行时接口

`InspectionService` 提供：

```text
createPlan(request, context)
updatePlan(request, context)
createTask(request, context)
assignExecutor(request, context)
startTask(request, context)
recordItemResult(request, context)
submitReview(request, context)
rejectReview(request, context)
archiveTask(request, context)
readTaskSummary(taskId, context)
readDashboardSummary(context)
```

上下文由底座注入：SQLite 事务、actor、权限门、审计写入、身份与角色解析器、归档阻断器、时钟、任务编码器、检查项编码器和事件编码器。

插件描述符实现固定钩子：配置校验、迁移、服务、明确 IPC、UI 和验收场景注册。`1.0.0` 不接受任何配置属性，未知配置失败关闭。

## 8. UI 扩展

本包只使用：

- `entity.detail.tabs`：检查项、异常处置、流转历史；
- `entity.detail.actions`：分派、开始、记录、提交和复核操作组；
- `dashboard.sections`：待执行、执行中、待复核、异常项和归档概览。

UI 描述符为纯数据，不包含直接数据库、IPC 或底座页面替换函数。

## 9. 公开扩展点与桥接

本包公开：

- `inspection_task.fields`、`inspection_task.relations`；
- `inspection_task.detail.tabs`、`inspection_task.create.sources`；
- `inspection_item.fields`、`inspection_item.relations`；
- `inspection.lifecycle.transitions`。

`inspection_task` 初始化严格的 `detailTabs` 和 `createSources` 数组，确保依赖包可实际追加描述符。

后续桥接包：

- 资产-巡检桥接依赖 `asset.core` 和 `inspection.core`，追加资产引用、资产详情巡检历史和受控创建来源；
- 巡检-工单桥接依赖 `inspection.core` 和 `work_order.core`，向异常检查项追加整改工单引用，并注册归档阻断器；
- 资产-工单桥接继续负责未关闭工单阻止资产停用；
- 三包组合验收覆盖“资产巡检异常 → 整改工单 → 工单关闭 → 巡检归档”。

桥接包不能用自有模块或工作流直接控制其他包实体，只能使用公开扩展点和运行时注册接口。

## 10. 确定性种子

`generateInspectionSeed({ seed, planCount, taskCount })`：

- 不使用 `Math.random`、当前时间或区域排序；
- 同参数输出字节稳定；
- 生成计划、任务、每任务 2–6 个检查项和一致事件；
- 任务状态覆盖四个状态；
- 检查项结果、异常字段和任务时间节点与状态一致；
- 使用通用岗位标识和合成内容，不包含真实企业或个人身份。

## 11. 验收标准

单包完成必须满足：

1. 目录和片段通过严格协议、所有权和现有蓝图验证；
2. 四个实体、四个角色、四个状态及完整复核闭环存在；
3. 正向流程从创建任务到归档通过真实 SQLite；
4. 空检查项、重复名称、无效计划和无效执行人被拒绝；
5. 巡检计划通用创建/更新被拒绝，领域命令保证周期为正整数；
6. 非当前执行人不能开始、记录或提交任务；
7. 未完成检查项不能提交；
8. 异常项缺少异常描述或处置说明时不能提交；
9. 执行人不能复核自己的任务；
10. 权限、身份、状态、版本顺序有防信息泄露测试；
11. 归档阻断器仅在归档时执行并能整体回滚；
12. 通用 CRUD 不能创建或修改计划、任务、检查项和事件；
13. 事件或审计失败不留下部分数据；
14. 插件通过生产 `PluginRegistry` 和 `loadRuntimeBlueprint` 加载并注册全部贡献；
15. 公开扩展容器通过真实依赖包组合测试；
16. UI 描述符只使用声明槽位且为纯数据；
17. 种子数据确定、引用有效且匿名；
18. 领域包、蓝图、桌面底座和 PowerShell 总回归全部通过；
19. 无依赖、构建、数据库、日志或敏感凭据产物被意外提交。
