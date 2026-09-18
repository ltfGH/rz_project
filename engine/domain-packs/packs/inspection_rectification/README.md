# 巡检与整改领域包

`inspection_rectification@1.0.0` 提供巡检计划、任务执行、检查项结果、异常处置、复核归档和只追加事件历史，能力 ID 为 `inspection.core`。核心包可独立使用，不强制依赖资产或工单。

## 实体与写入边界

| 实体 | 用途 | 写入边界 |
| --- | --- | --- |
| `inspection_plan` | 巡检计划和周期 | 领域命令创建、更新 |
| `inspection_task` | 实际执行任务和状态 | 领域命令写入 |
| `inspection_item` | 检查标准、结果和异常处置 | 领域命令写入 |
| `inspection_event` | 创建、开始、记录、提交、复核历史 | 系统管理，只追加 |

四个实体均禁止通用创建或更新。计划周期必须为正整数；任务创建时必须同时创建 1–100 个名称唯一的检查项。

## 状态闭环

```text
pending -> executing -> pending_review -> archived
              ^              |
              +--- reject ---+
```

- 只有当前执行人可以开始、记录结果和提交复核；
- 检查项结果更新同时校验任务版本和检查项版本；
- 所有检查项完成后才能提交；
- 异常项必须包含异常描述和处置说明；
- 执行人不能复核自己的任务；
- 归档后任务和检查项只读。

每个命令在调用方 SQLite 事务中更新业务记录、追加巡检事件和审计。任何后置写入失败都整体回滚。

## 归档阻断

`InspectionContext.archiveBlockers` 允许桥接包注册只读阻断器。阻断器只在归档时运行；任一阻断器报告未完成业务，任务保持待复核且不写事件。

巡检-工单桥接会用它检查异常项对应的整改工单是否全部关闭。

## 角色

- `inspection_planner`：维护计划、创建任务、调整执行人；
- `inspection_executor`：开始本人任务、记录检查项、提交复核；
- `inspection_reviewer`：驳回返工、复核归档；
- `inspection_admin`：维护计划、查看全部业务数据。

## 扩展与桥接

核心包公开任务字段、关系、详情页签、创建来源，检查项字段、关系以及生命周期迁移扩展点。

- 资产-巡检桥接追加资产引用和资产详情巡检历史；
- 巡检-工单桥接追加整改工单引用和归档阻断器；
- 三包组合形成“资产巡检异常 → 整改工单 → 工单关闭 → 巡检归档”。

## 确定性种子

```ts
generateInspectionSeed({ seed, planCount, taskCount })
```

`planCount` 为 1–50，`taskCount` 为 4–10000。每任务生成 2–6 个检查项，覆盖四种状态，事件和节点时间一致，不使用当前时间、`Math.random` 或真实身份。

## 验证

从 `engine/domain-packs` 执行：

```powershell
npm run typecheck
npm test
npm run build
```

验收场景通过生产插件路径在真实 SQLite 中运行创建、开始、正常/异常记录、提交、驳回、重做、再次提交和归档。
