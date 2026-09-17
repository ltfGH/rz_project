# 工单与服务领域包

`work_order_service@1.0.0` 为离线业务软件提供服务目录、SLA 固化、工单处理复核闭环和只追加事件历史，提供领域能力 `work_order.core`。本包兼容业务蓝图 `1.0` 与桌面运行时 `1.0.0`，可脱离资产台账独立使用。

## 数据模型

| 实体 | 用途 | 写入边界 |
| --- | --- | --- |
| `service_catalog` | 服务目录 | 受角色权限控制的通用创建和更新 |
| `sla_policy` | 服务与优先级对应的响应/解决时限 | 受角色权限控制的通用创建和更新 |
| `work_order` | 工单主记录、当前状态和固化时间节点 | 只允许领域命令写入 |
| `work_order_event` | 创建、派单、处理、提交和复核历史 | 系统管理，只追加 |

工单创建时按 `service_code + priority` 查找唯一启用 SLA，并固化 `response_due_at` 和 `resolution_due_at`。策略后续变化不会修改历史工单。

## 状态闭环

```text
pending_dispatch -> pending_acceptance -> processing -> pending_review -> closed
                                            ^               |
                                            +--- reject ----+
```

- `dispatch`：首次派单；
- `redispatch`：待受理状态重新派单；
- `accept`：仅当前被派处理人可受理；
- `addProcessingRecord`：处理中追加记录，不改变状态但递增版本；
- `submitResolution`：至少存在一条处理记录后才可提交；
- `rejectReview`：复核驳回并返回处理中；
- `approveClose`：由不同于处理人的复核人员关闭。

关闭后不允许继续处理或普通编辑。每个命令都使用乐观版本条件，并在调用方提供的 SQLite 事务中更新工单、追加事件和审计。事件或审计失败时事务整体回滚。

## 角色与权限

- `work_order_dispatcher`：创建、派单、重新派单；
- `work_order_handler`：受理本人工单、记录处理、提交解决；
- `work_order_reviewer`：驳回返工、复核关闭；
- `work_order_admin`：维护服务目录和 SLA、查看工单历史。

权限只允许尝试命令。运行时仍会校验当前处理人、身份角色、处理/复核分离、状态和版本。

## SLA 计算

- 响应截止：`created_at + response_minutes`；
- 解决截止：`created_at + resolution_minutes`；
- 响应结果使用 `accepted_at`，未受理时使用注入时钟判断是否超时；
- 解决结果使用复核 `closed_at`，未关闭时使用注入时钟判断是否超时；
- 实际时间等于截止时间视为达标。

## UI 与插件

本包仅注册：

- `entity.detail.tabs`：处理记录、流转历史、SLA 状态；
- `entity.detail.actions`：工单状态操作组；
- `dashboard.sections`：动态 SLA 概览。

UI 描述符为纯数据。生产插件实现配置校验、迁移、服务、明确 IPC 命令、UI 和验收场景全部固定钩子，未知配置失败关闭。

## 确定性种子

```ts
generateWorkOrderSeed({ seed, serviceCount, orderCount })
```

- `seed`：32 位整数；
- `serviceCount`：1–50；
- `orderCount`：5–10000。

每个服务生成低、普通、高、紧急四条 SLA。工单覆盖全部五个状态，事件链和时间节点与状态一致；同参数输出字节稳定，不使用当前时间、`Math.random` 或真实企业与个人身份。

## 公开扩展与资产桥接

本包公开工单字段、关系、详情页签、生命周期迁移和受控创建来源扩展点。核心包不包含资产字段。

后续资产桥接包同时依赖 `asset.core` 和 `work_order.core`，通过公开扩展点追加资产引用和详情页签，并向资产生命周期注册只读阻断器：存在未关闭工单时禁止资产停用。桥接包不能用自有模块或工作流直接控制工单或资产实体。

## 验证

从 `engine/domain-packs` 执行：

```powershell
npm run typecheck
npm test
npm run build
```

单包验收通过生产插件注册路径，在真实 SQLite 中执行创建、派单、受理、处理、提交、驳回、再次处理、再次提交和关闭，并核对版本、事件、审计、SLA 和仪表盘。
