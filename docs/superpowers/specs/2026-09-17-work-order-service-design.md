# 工单与服务领域包设计

## 1. 目标

实现生产级 `work_order_service@1.0.0` 领域包，为离线业务软件提供可长期使用的服务目录、SLA、工单闭环和不可篡改流转历史。工单核心包可独立组合，不强制依赖资产台账；资产关联和资产停用阻断由后续组合桥接包实现。

本包兼容业务蓝图 `1.0` 和桌面运行时 `1.0.0`，提供能力 `work_order.core`。

## 2. 范围与边界

本包负责：

- 服务目录及其启停管理；
- 按服务目录和优先级维护 SLA 策略；
- 工单创建、派单、受理、处理、提交解决、复核关闭和驳回返工；
- 响应和解决时限固化、达标状态计算；
- 每次领域操作的工单事件与系统审计；
- 确定性离线演示数据；
- 受控详情页签、操作描述符和单包验收场景。

本包不负责：

- 资产、巡检异常、库存领用或项目任务实体；
- 短信、邮件、即时通信或云端通知；
- 自动派单算法、排班、计费或合同管理；
- 动态脚本、任意 SQL 或模型生成后执行的业务代码；
- 绕过底座会话、权限、审计、事务和备份恢复机制。

## 3. 数据模型

### 3.1 `service_catalog`

服务目录，允许通过通用 CRUD 维护。

- `code`：唯一稳定编码；
- `name`：服务名称；
- `description`：服务说明；
- `active`：是否可用于新工单。

已被 SLA 或工单引用的服务目录受外键限制，不能硬删除。

### 3.2 `sla_policy`

SLA 策略由领域命令创建和更新，通用仓储只允许列表和查看。

- `code`：唯一稳定编码；
- `name`：策略名称；
- `service_code`：有效服务目录引用；
- `priority`：`low`、`normal`、`high`、`urgent`；
- `response_minutes`：从创建到受理的最大分钟数；
- `resolution_minutes`：从创建到复核关闭的最大分钟数；
- `active`：是否可匹配新工单。

同一服务目录和优先级只能存在一条启用策略，响应和解决时限必须为正整数。创建或更新策略时在同一事务内校验这些规则，不依赖 SQLite 复合索引。

### 3.3 `work_order`

工单主记录，所有业务写入由领域服务控制，通用仓储只允许列表和查看。

- `code`：唯一稳定编码；
- `title`、`description`：标题与问题描述；
- `service_code`：服务目录引用；
- `sla_policy_code`：创建时命中的 SLA 策略引用；
- `priority`：创建时优先级；
- `status`：当前状态；
- `requester_id`：创建人稳定身份标识；
- `handler_id`：当前处理人稳定身份标识，可为空；
- `resolution`：提交解决说明，可为空；
- `response_due_at`、`resolution_due_at`：创建时固化的截止时间；
- `accepted_at`、`submitted_at`、`closed_at`：实际业务节点时间，可为空。

已关闭工单不可通过普通编辑修改。所有状态、处理人、解决说明和节点时间只能由明确领域命令更新。

### 3.4 `work_order_event`

系统管理、只追加的工单事件历史。

- `code`：唯一事件编码；
- `work_order_code`：工单引用；
- `event_type`：`created`、`dispatched`、`accepted`、`processing_recorded`、`resolution_submitted`、`review_rejected`、`closed`；
- `from_status`、`to_status`：状态变化前后值，可为空；
- `actor_id`：操作人稳定身份标识；
- `content`：处理内容或操作原因；
- `occurred_at`：发生时间。

事件实体使用 `append_only`、`history: true`、`systemManaged: true`，不提供通用创建、更新或删除动作。

## 4. 状态机

状态为：

- `pending_dispatch`：待分派；
- `pending_acceptance`：待受理；
- `processing`：处理中；
- `pending_review`：待复核；
- `closed`：已关闭。

允许迁移：

| 命令 | 起始状态 | 目标状态 | 权限 |
| --- | --- | --- | --- |
| `dispatch` | `pending_dispatch` | `pending_acceptance` | `work_orders.dispatch` |
| `redispatch` | `pending_acceptance` | `pending_acceptance` | `work_orders.dispatch` |
| `accept` | `pending_acceptance` | `processing` | `work_orders.accept` |
| `submit_resolution` | `processing` | `pending_review` | `work_orders.submit_resolution` |
| `reject_review` | `pending_review` | `processing` | `work_orders.review` |
| `approve_close` | `pending_review` | `closed` | `work_orders.review` |

`create` 创建 `pending_dispatch` 工单；`add_processing_record` 不改变状态，但只允许在 `processing` 状态执行。

## 5. 领域规则

### 5.1 创建与 SLA 固化

创建工单时必须：

1. 校验创建人身份有效；
2. 校验服务目录存在且启用；
3. 按 `service_code + priority` 找到唯一启用 SLA；
4. 以注入时钟为基准计算并保存两个截止时间；
5. 创建工单和 `created` 事件并写审计。

找不到 SLA 或匹配到多条启用策略时失败，不保留部分数据。后续修改 SLA 不回写历史工单截止时间。

### 5.2 派单与受理

- 派单处理人必须由调用方身份注册表确认存在且可承担处理角色；
- 待受理状态允许重新派单，每次重新派单均追加事件；
- 只有当前 `handler_id` 对应用户可以受理、记录处理过程和提交解决；
- 受理时写入 `accepted_at`，首次受理时间用于判断响应 SLA。

### 5.3 处理与提交

- `add_processing_record` 要求非空处理内容并追加 `processing_recorded` 事件；
- 提交解决前，当前工单必须至少存在一条处理记录；
- `submit_resolution` 要求非空解决说明，保存 `resolution` 和 `submitted_at`；
- 驳回后回到 `processing`，保留历史处理与驳回事件，可继续追加处理记录并再次提交。

### 5.4 复核分离与关闭

- 复核人必须由调用方身份注册表确认存在且具备复核角色；
- 复核人身份不得与当前处理人相同；
- 复核关闭写入 `closed_at`，并以该时间判断解决 SLA；
- 关闭后不再允许状态迁移、处理记录或普通编辑。

### 5.5 并发与原子性

所有领域命令接收 `expectedVersion` 并使用版本条件更新。版本不匹配返回 `VERSION_CONFLICT`。

每个命令在调用方已经开启的 SQLite 事务内完成：

1. 校验权限、身份、状态、版本和领域条件；
2. 更新或创建工单；
3. 追加工单事件；
4. 追加系统审计；
5. 返回冻结结果 DTO。

事件、审计或后续写入失败时，调用方事务整体回滚。服务不打开数据库连接、不自行提交事务、不访问网络。

## 6. SLA 计算

SLA 使用绝对 UTC 时间：

- `response_due_at = created_at + response_minutes`；
- `resolution_due_at = created_at + resolution_minutes`；
- 响应达标：`accepted_at <= response_due_at`；
- 解决达标：`closed_at <= resolution_due_at`；
- 未受理或未关闭时，使用注入时钟计算 `pending`、`overdue` 状态，不写回数据库。

仪表盘至少包含：工单总数、待处理数量、待复核数量、已关闭数量、当前已超时数量。

## 7. 角色与权限

### 7.1 `work_order_dispatcher`

- 创建工单；
- 派单和重新派单；
- 查看服务目录、SLA、工单和事件。

### 7.2 `work_order_handler`

- 受理本人被派工单；
- 追加处理记录；
- 提交解决；
- 查看相关配置、工单和事件。

### 7.3 `work_order_reviewer`

- 复核关闭；
- 驳回返工；
- 查看服务目录、SLA、工单和事件。

### 7.4 `work_order_admin`

- 创建和维护服务目录、SLA 策略；
- 查看全部工单和事件；
- 不因管理员身份绕过处理人与复核人分离规则。

权限只表示允许尝试命令；运行时仍校验当前处理人、复核人分离、状态和版本。

## 8. 运行时接口

`WorkOrderService` 提供：

```text
createSlaPolicy(request, context)
updateSlaPolicy(request, context)
create(request, context)
dispatch(request, context)
accept(request, context)
addProcessingRecord(request, context)
submitResolution(request, context)
approveClose(request, context)
rejectReview(request, context)
readSlaStatus(workOrderId, context)
```

上下文由底座注入：SQLite 事务、actor、权限门、审计写入、身份与角色解析器、时钟、工单编码器和事件编码器。

插件描述符实现固定钩子：配置校验、迁移、服务、IPC、UI 和验收场景注册。`1.0.0` 不接受任何配置属性，未知配置失败关闭。

## 9. UI 扩展

本包只使用：

- `entity.detail.tabs`：处理记录、流转历史、SLA 状态；
- `entity.detail.actions`：派单、受理、处理、提交和复核操作组；
- `dashboard.sections`：工单概览和 SLA 状态区。

UI 描述符为纯数据，不包含直接数据库、IPC 或底座页面替换函数。

## 10. 公开扩展点与组合桥接

本包公开：

- `work_order.fields`：追加受控业务字段；
- `work_order.relations`：追加关系；
- `work_order.detail.tabs`：追加详情展示；
- `work_order.lifecycle.transitions`：追加经过所有权校验的领域迁移；
- `work_order.create.sources`：注册告警、巡检异常等受控创建来源。

后续资产桥接包同时依赖 `asset.core` 和 `work_order.core`，负责：

- 向工单追加 `asset_code` 引用及关系；
- 向资产详情追加工单页签；
- 注册查询未关闭工单的只读阻断器，阻止相关资产停用；
- 在组合验收中验证关闭工单后资产才可停用。

桥接包不能通过自有模块或工作流直接控制其他包实体，只能使用双方公开扩展点和运行时注册接口。

## 11. 确定性种子

`generateWorkOrderSeed({ seed, serviceCount, orderCount })`：

- 不使用 `Math.random`、当前时间或区域排序；
- 同参数输出字节稳定；
- 生成服务目录、每个服务和优先级的 SLA、工单及一致事件；
- 工单状态分布覆盖全部五个状态；
- 处理记录、解决说明和时间节点与状态一致；
- 使用通用岗位标识和合成内容，不包含真实公司或个人身份。

## 12. 验收标准

单包完成必须满足：

1. 目录和片段通过严格协议、所有权和现有蓝图验证；
2. 四个实体、四个角色、五个状态及完整闭环存在；
3. 正向流程从创建到关闭通过真实 SQLite；
4. 权限拒绝、身份无效、非法状态、版本冲突均有测试；
5. 无处理记录不能提交解决；
6. 处理人不能复核自己的工单；
7. SLA 策略通用创建/更新被拒绝，领域命令保证正时限和启用组合唯一；
8. SLA 达标、未完成超时和关闭超时计算准确；
9. 通用 CRUD 不能修改工单状态、处理人或事件历史；
10. 事件或审计失败不留下部分工单数据；
11. 插件通过生产 `PluginRegistry` 和 `loadRuntimeBlueprint` 加载并注册全部贡献；
12. UI 描述符只使用声明槽位且为纯数据；
13. 种子数据确定、引用有效且匿名；
14. 领域包、蓝图、桌面底座和 PowerShell 总回归全部通过；
15. 无依赖、构建、数据库、日志或敏感凭据产物被意外提交。
