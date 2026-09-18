# 库存与批次领域包设计

## 1. 目标

实现生产级 `inventory_batch@1.0.0` 领域包，为离线业务软件提供物料、仓库、批次余额、入库、领用、退库、调整、效期预警和只追加库存流水。核心包可独立使用，审批、项目任务和资产备件关系由后续桥接包组合。

本包兼容业务蓝图 `1.0` 和桌面运行时 `1.0.0`，提供能力 `inventory.core`。

## 2. 范围与边界

本包负责：

- 物料和仓库配置；
- 指定物料、仓库和批次的首次及后续入库；
- 指定批次领用和引用原领用流水的退库；
- 有原因的正向或负向库存调整；
- 批次余额与不可变流水同事务保存；
- 生产、入库、到期日期与效期预警；
- 批次历史删除守卫；
- 确定性离线演示数据、受控 UI 和真实 SQLite 验收。

本包不负责自动 FIFO、采购、供应商、成本核算、条码设备、云同步、审批流程或项目/资产实体。

## 3. 数据模型

### 3.1 `material`

领域管理的物料主档：

- `code`：唯一稳定编码；
- `name`：物料名称；
- `unit`：非空计量单位；
- `expiry_warning_days`：非负整数；
- `active`：是否可用于新批次和事务。

### 3.2 `warehouse`

领域管理的仓库主档：

- `code`：唯一稳定编码；
- `name`：仓库名称；
- `active`：是否可用于新批次和事务。

### 3.3 `inventory_batch`

系统管理的批次及当前余额：

- `code`：唯一稳定内部编码；
- `material_code`、`warehouse_code`：有效引用；
- `batch_no`：业务批次号；
- `produced_at`：生产日期，可为空；
- `received_at`：首次入库日期；
- `expires_at`：到期日期，可为空；
- `quantity`：当前非负数量；
- `active`：是否允许继续发生事务。

同一 `material_code + warehouse_code + batch_no` 只能存在一条批次，由首次入库领域命令校验。日期满足：有生产日期时 `produced_at <= received_at`；有到期日期时 `received_at <= expires_at`。

### 3.4 `inventory_transaction`

系统管理、只追加库存流水：

- `code`：唯一稳定流水编码；
- `batch_code`：批次引用；
- `transaction_type`：`receipt`、`issue`、`return`、`adjustment_in`、`adjustment_out`；
- `quantity`：正数；
- `source_transaction_code`：退库时引用原领用流水，其他类型为空；
- `operator_id`：操作人稳定身份标识；
- `reason`：业务原因；
- `occurred_at`：发生时间。

领用流水保持不可变。累计已退数量由所有引用该领用流水的 `return` 记录实时求和，未退数量为 `issue.quantity - SUM(return.quantity)`。

## 4. 领域命令

`InventoryService` 提供：

```text
createMaterial / updateMaterial
createWarehouse / updateWarehouse
receiveBatch
issueStock
returnStock
adjustStock
assertCanDeleteBatch
readExpiryWarnings
readInventorySummary
```

上下文由底座注入：SQLite 事务、actor、权限门、审计写入、身份角色解析、时钟、物料/仓库/批次/流水编码器和可选领用阻断器。

## 5. 领域规则

### 5.1 配置

- 物料单位非空，效期预警天数为非负整数；
- 停用物料或仓库不能发生新入库、领用、退库或调整；
- 物料和仓库禁止通用创建或更新。

### 5.2 入库

- 数量必须为有限正数；
- 首次入库创建批次、余额和 `receipt` 流水；
- 后续入库按批次 ID 和期望版本增加余额；
- 同一物料、仓库、批次号重复首次入库返回 `UNIQUE_CONFLICT`；
- 日期关系不合法时不写批次或流水。

### 5.3 领用

- 调用方明确指定批次，不自动选择 FIFO；
- 批次必须启用、未过期且余额充足；
- 领用数量必须为正，更新后余额不得小于零；
- 更新批次版本并追加 `issue` 流水和审计。

### 5.4 退库

- 必须引用存在的 `issue` 流水；
- 原领用流水必须属于同一批次；
- 退库数量为正，累计退库不得超过原领用数量；
- 同事务增加批次余额并追加 `return` 流水和审计；
- 不修改原领用流水。

### 5.5 调整

- 调整数量为正并明确方向；
- 原因必须非空；
- 负向调整后余额不得小于零；
- 更新批次版本，追加 `adjustment_in` 或 `adjustment_out` 流水和审计。

### 5.6 删除与效期

- `assertCanDeleteBatch` 只提供守卫，不执行删除；
- 有任意流水的批次禁止硬删除；
- 无流水批次才可由后续底座删除服务处理；
- 效期状态使用注入时钟和真实 `expires_at` 计算 `normal`、`warning`、`expired`；
- 无到期日期的批次状态为 `not_applicable`；
- 当前时间等于到期日边界时视为到期。

### 5.7 原子性与错误顺序

写命令按权限、读取、身份、状态/领域条件、版本、条件 SQL、流水、审计顺序执行。批次更新使用 `WHERE id = ? AND version = ?`。流水或审计失败时调用方事务整体回滚。

## 6. 角色

- `inventory_keeper`：入库、库存调整、查看批次和流水；
- `inventory_requester`：领用、退回本人允许的库存、查看库存；
- `inventory_reviewer`：查看全部流水并执行受控高风险调整；
- `inventory_admin`：维护物料、仓库和参数，查看全部库存数据。

权限只允许尝试命令，运行时仍校验身份、批次、余额、日期、来源流水和版本。

## 7. UI 与仪表盘

本包只使用：

- `entity.detail.tabs`：库存流水、领用退库历史、效期状态；
- `entity.detail.actions`：入库、领用、退库、调整和配置操作组；
- `dashboard.sections`：库存总量、批次数、预警批次、过期批次和近期流水。

动态效期指标由运行时只读汇总服务计算，不用静态蓝图过滤冒充当前时间。

## 8. 公开扩展与桥接

公开扩展点：

- `material.fields`、`material.relations`；
- `inventory_batch.fields`、`inventory_batch.relations`；
- `inventory_batch.detail.tabs`、`inventory_batch.create.sources`；
- `inventory_transaction.fields`、`inventory_transaction.relations`。

后续桥接：

- 申请-库存桥接：审批通过后允许领用，拒绝或撤回不改变库存；
- 项目-库存桥接：领用流水关联项目任务；
- 资产-库存桥接：物料/批次关联资产备件。

桥接包只能使用公开扩展和运行时注册接口，不能通过自有模块直接控制库存实体。

## 9. 确定性种子

`generateInventorySeed({ seed, materialCount, warehouseCount, batchCount })`：

- seed 使用无符号 32 位整数；
- 相同参数字节稳定，不使用当前时间或 `Math.random`；
- 批次引用有效物料和仓库；
- 余额等于入库、领用、退库和调整流水净和；
- 包含正常、预警、过期和无效期批次；
- 使用合成岗位和内容，不包含真实企业或个人身份。

## 10. 验收标准

1. 四实体、四角色、只追加流水及生产插件通过严格验证；
2. 物料/仓库配置校验和通用写保护通过；
3. 首次/后续入库、领用、退库和调整通过真实 SQLite；
4. 唯一批次、日期关系、正数量和非负库存被强制；
5. 超额退库和错误来源流水被拒绝；
6. 批次与流水、审计在后置失败时整体回滚；
7. 有流水批次删除守卫生效；
8. 效期边界和动态仪表盘准确；
9. 插件、UI、扩展容器和真实依赖包组合通过；
10. 种子确定、匿名、引用和余额一致；
11. 领域包、蓝图、桌面底座和 PowerShell 总回归通过；
12. 无临时产物或敏感凭据进入仓库。
