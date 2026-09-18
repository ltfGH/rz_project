# 项目与任务领域包设计

## 1. 目标

实现生产级 `project_task@1.0.0` 领域包，为可长期离线使用的业务软件提供项目、里程碑、加权任务、风险、交付版本和只追加事件。核心包独立运行，不强制依赖工单、库存、申请或归档包；跨领域关系由后续桥接包组合。

本包兼容业务蓝图 `1.0` 和桌面运行时 `1.0.0`，提供能力 `project.core`。

## 2. 范围与边界

本包负责：

- 项目计划、激活、申请关闭、驳回和复核关闭；
- 里程碑及其任务、交付物完成条件；
- 任务负责人、权重、执行、进展、验收、驳回、取消和恢复；
- 从真实任务权重派生项目进度；
- 低、中、高风险登记、缓解、重开和关闭；
- 交付物多版本提交与验收，旧版本保持不变；
- 项目关闭条件、可扩展关闭阻断器和只追加事件；
- 确定性演示数据、声明式 UI、生产插件和真实 SQLite 验收。

本包不负责预算、费用、工时计费、资源排班、甘特图自动调度、在线协作、实际文件存储、电子签章、采购、库存扣减或审批引擎。

## 3. 数据模型

### 3.1 `project`

- `code`：唯一稳定编码；
- `name`：项目名称；
- `manager_id`：项目经理身份；
- `status`：`planning | active | pending_close | closed`；
- `planned_start_at`、`planned_end_at`：计划日期；
- `progress`：系统派生的 0–100 数值；
- `close_requested_by`、`close_requested_at`：最近关闭申请；
- `closed_by`、`closed_at`：最终关闭信息；
- `version`：乐观版本。

项目编码创建后永久稳定；名称、经理和计划日期仅在 `planning` 状态可按权限修改。`progress`、状态、关闭信息只能由领域服务写入。

### 3.2 `milestone`

- `code`：唯一稳定编码；
- `project_code`：所属项目；
- `name`：里程碑名称；
- `due_at`：计划完成日期；
- `status`：`pending | completed`；
- `completed_by`、`completed_at`：完成人和时间；
- `version`：乐观版本。

里程碑完成前必须满足其全部必需任务和必需交付物条件。

### 3.3 `project_task`

- `code`：唯一稳定编码；
- `project_code`：所属项目；
- `milestone_code`：可选里程碑；
- `title`、`description`：任务说明；
- `assignee_id`：当前负责人；
- `weight`：正整数权重；
- `required`：是否为项目关闭必需任务；
- `status`：`pending | in_progress | pending_review | completed | cancelled`；
- `progress_note`：最近进展说明；
- `submitted_at`、`completed_at`、`cancelled_at`：状态时间；
- `version`：乐观版本。

取消任务保留记录和事件，但不进入项目进度分母。恢复后回到 `pending` 并重新进入进度计算。

### 3.4 `project_risk`

- `code`：唯一稳定编码；
- `project_code`：所属项目；
- `title`、`description`：风险内容；
- `level`：`low | medium | high`；
- `status`：`open | mitigated | closed`；
- `disposition`：处置说明；
- `reported_by`、`closed_by`、`closed_at`：登记和关闭信息；
- `version`：乐观版本。

中低风险申请关闭项目前必须有非空处置说明；高风险必须已经关闭。

### 3.5 `deliverable`

每行代表一个不可覆盖的业务版本：

- `code`：版本记录唯一编码；
- `project_code`：所属项目；
- `milestone_code`：可选里程碑；
- `deliverable_key`：同一交付物版本链的稳定键；
- `name`：交付物名称；
- `business_version`：业务版本号，同一版本链内唯一；
- `required`：是否为关闭或里程碑完成必需交付物；
- `file_name`、`file_digest`：文件显示名和摘要，不保存二进制内容；
- `status`：`submitted | accepted | rejected`；
- `submitted_by`、`submitted_at`、`reviewed_by`、`reviewed_at`、`review_comment`：提交和验收信息；
- `version`：创建时为 1，验收或驳回时通过乐观锁递增为 2，此后不可再更新。

业务版本内容提交后不可修改，仅允许对 `submitted` 版本执行一次验收或驳回。驳回后必须新增业务版本。判断完成条件时仅使用同一 `deliverable_key` 的最新版本。

### 3.6 `project_event`

系统管理、只追加历史：

- `code`：唯一事件编码；
- `project_code`：所属项目；
- `subject_type`：`project | milestone | task | risk | deliverable`；
- `subject_code`：业务对象编码；
- `event_type`：稳定事件类型；
- `from_status`、`to_status`：可选状态变化；
- `actor_id`：操作人；
- `comment`：业务说明；
- `occurred_at`：发生时间。

## 4. 进度公式

项目进度只从未取消任务计算：

```text
有效总权重 = SUM(task.weight WHERE status != cancelled)
完成权重 = SUM(task.weight WHERE status = completed)
项目进度 = 有效总权重为 0 时取 0，否则 ROUND(完成权重 / 有效总权重 × 100, 2)
```

任务创建、完成、取消和恢复必须在同一事务中重新计算并写回项目进度。调用方不能直接设置进度。

## 5. 状态与命令

### 5.1 项目

```text
planning -> active -> pending_close -> closed
               ^           |
               +-- reject -+
```

- `createProject`：管理员或项目经理创建计划中项目；
- `updateProject`：项目经理在 `planning` 状态修改名称和计划日期，管理员可同时调整项目经理；项目激活后基础信息冻结；
- `activateProject`：项目经理激活项目；
- `requestProjectClose`：项目经理发起关闭并执行全部关闭条件；
- `rejectProjectClose`：复核人驳回到进行中；
- `approveProjectClose`：复核人最终关闭，不能与关闭申请人为同一身份。

关闭后项目及其里程碑、任务、风险和交付物只读。

### 5.2 任务

```text
pending -> in_progress -> pending_review -> completed
                ^              |
                +--- reject ---+
```

- 项目经理在活动项目中创建任务、调整待开始任务负责人和权重；
- 当前负责人开始、追加非空进展说明并提交验收；
- 项目经理验收或驳回，且不能验收自己作为负责人提交的任务；
- 项目经理可取消未完成任务；
- 项目经理可恢复取消任务到 `pending`；
- 完成任务不允许取消、恢复或普通编辑。

### 5.3 里程碑

项目经理创建里程碑。`completeMilestone` 要求：

- 项目处于 `active`；
- 里程碑尚未完成且版本匹配；
- 关联到该里程碑的必需任务全部为 `completed`；
- 每个必需交付物版本链的最新版本为 `accepted`。

### 5.4 风险

- 项目成员和项目经理可登记风险；
- 登记人或项目经理可补充处置说明并将风险标记为 `mitigated`；
- 复核人关闭风险；
- 项目经理或复核人可将已缓解、已关闭风险重新打开；
- 高风险关闭必须由复核人执行。

### 5.5 交付物

- 项目成员在活动项目中提交新版本；
- 同一 `project_code + deliverable_key + business_version` 唯一；
- 项目经理或复核人验收、驳回待验收版本；
- 提交人不能验收自己的版本；
- 已验收或已驳回版本不可修改；重新提交必须使用新业务版本。

## 6. 项目关闭条件

`requestProjectClose` 按以下顺序检查：

1. 当前身份是项目经理且管理该项目；
2. 项目状态为 `active`；
3. 全部里程碑已完成；
4. 全部必需、未取消任务已完成；
5. 每个必需交付物版本链的最新版本已验收；
6. 不存在未关闭高风险；
7. 所有未关闭中低风险均有非空处置说明；
8. 所有注册的只读关闭阻断器均通过；
9. 项目版本匹配。

任一条件失败时不改变项目、事件或审计。阻断器只获得冻结的参数化 `find` 查询接口，不获得原始 SQLite 连接。

## 7. 原子性与错误顺序

服务不自行开启事务。调用方提供当前 SQLite 事务连接。写命令依次执行：

1. 权限；
2. 读取业务对象；
3. 身份和归属；
4. 当前状态；
5. 领域条件和只读阻断器；
6. 乐观版本；
7. 条件更新或插入；
8. 项目进度重算；
9. 只追加事件；
10. 审计。

事件、进度或审计失败时，调用方事务整体回滚。所有 SQL 值参数化；动态标识符仅允许严格白名单。

## 8. 角色与权限

- `project_member`：查看项目，执行本人任务，登记和处置风险，提交交付版本；
- `project_manager`：创建和管理本人项目、里程碑和任务，验收任务/交付物，发起关闭；
- `project_reviewer`：关闭风险、驳回或批准项目关闭、复核交付物；
- `project_admin`：维护项目基础信息、查看全部项目和审计数据。

权限只允许尝试命令。运行时仍校验当前负责人、项目经理、提交人/验收人分离、关闭申请/复核分离、状态和版本。

## 9. UI 与动态汇总

UI 描述符只包含纯数据，使用：

- `entity.detail.tabs`：里程碑、任务、风险、交付版本、事件；
- `entity.detail.actions`：项目、任务、风险和交付验收操作；
- `dashboard.sections`：项目概览。

运行时动态汇总：

- 各项目状态数量；
- 当前日期已超过计划结束日的未关闭项目；
- 已超过里程碑日期的未完成里程碑；
- 待验收任务数量；
- 未关闭高风险数量；
- 待验收交付版本数量。

## 10. 公开扩展与桥接

公开扩展点：

- `project.fields`、`project.relations`、`project.detail.tabs`、`project.create.sources`；
- `project_task.fields`、`project_task.relations`、`project_task.detail.tabs`、`project_task.create.sources`；
- `project_risk.fields`、`project_risk.relations`；
- `deliverable.fields`、`deliverable.relations`；
- 项目关闭阻断器注册接口。

桥接职责：

- 工单-项目：工单关联任务；
- 库存-项目：领用流水关联任务；
- 项目-归档：保存交付物实际文件、哈希校验并阻止未归档项目关闭；
- 项目-申请：立项或交付审批控制创建来源和关闭阻断。

桥接包不能绕过 `ProjectService` 直接修改项目状态、任务进度或交付验收结果。

## 11. 确定性种子

```ts
generateProjectSeed({ seed, projectCount, tasksPerProject })
```

- `seed` 为无符号 32 位整数；
- 使用固定基准时间和 xorshift32，不使用当前时间或 `Math.random`；
- 覆盖四种项目状态、任务驳回重做、取消任务、里程碑、三种风险等级和多版本交付物；
- 项目进度与任务权重严格一致；
- 事件链、状态时间和业务对象一致；
- 使用合成岗位身份，不包含真实企业或人员信息。

## 12. 插件与验收

生产插件固定注册：

- 配置校验；
- `project_task.v1` 迁移；
- `project.lifecycle` 服务；
- 每个领域命令和只读汇总的显式 IPC；
- 声明式 UI 扩展；
- `project.lifecycle.acceptance` 验收场景。

真实 SQLite 验收执行：

```text
创建项目 -> 激活 -> 创建里程碑和任务
-> 开始任务 -> 提交 -> 驳回 -> 重做 -> 验收
-> 提交交付物 -> 驳回 -> 新版本提交 -> 验收
-> 缓解并关闭高风险 -> 完成里程碑
-> 申请关闭 -> 独立复核关闭
```

验收同时核对项目进度、版本、事件、审计、不可变交付版本、动态汇总和事务回滚。

## 13. 验收标准

1. 六实体、四角色、插件和蓝图片段通过严格校验；
2. 六实体通用创建和更新均被拒绝；
3. 项目进度只由未取消任务权重派生；
4. 任务负责人和验收人身份、状态、版本顺序正确；
5. 任务完成、取消和恢复与项目进度、事件、审计原子保存；
6. 里程碑被必需任务和最新交付版本正确阻断；
7. 高风险和未处置中低风险正确阻止项目关闭；
8. 交付物旧版本不可修改，提交人与验收人分离；
9. 项目关闭申请人与最终复核人分离；
10. 关闭阻断器仅获得只读参数化查询接口；
11. 动态仪表盘使用注入时钟和当前 SQLite 状态；
12. 确定性种子引用、进度、事件和状态一致；
13. 公开扩展点由磁盘完整依赖包通过最终蓝图验证；
14. 生产插件真实 SQLite 验收通过；
15. 领域包、蓝图、桌面运行时和 PowerShell 总回归通过；
16. 仓库不包含临时数据库、日志、安装包或敏感凭据。
