# 巡检与整改领域包实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可独立组合的生产级 `inspection_rectification@1.0.0`，实现巡检计划、任务与检查项执行、异常处置、复核归档、归档阻断、确定性种子和真实 SQLite 验收。

**Architecture:** 在 `engine/domain-packs/packs/inspection_rectification` 下实现独立目录、蓝图片段和固定插件入口。计划、任务、检查项和事件的业务写入均由领域命令控制；服务只使用调用方传入的 SQLite 事务、actor、权限门、身份解析、阻断器、时钟、编码器和审计写入。资产和工单关系不进入核心包，后续桥接包通过严格扩展容器和归档阻断器组合。

**Tech Stack:** TypeScript 7、Node test runner、tsx、`node:sqlite`、现有领域包组合器、蓝图验证器和桌面运行时插件注册协议。

**Spec:** `docs/superpowers/specs/2026-09-18-inspection-rectification-design.md`

## 全局约束

- 包 ID 和版本固定为 `inspection_rectification@1.0.0`。
- 兼容业务蓝图 `1.0` 和桌面运行时 `1.0.0`。
- 提供 `inspection.core`，不强制依赖 `asset.core` 或 `work_order.core`。
- 只拥有 `inspection_plan`、`inspection_task`、`inspection_item`、`inspection_event` 四个实体。
- 任务状态固定为 `pending`、`executing`、`pending_review`、`archived`。
- 计划、任务、检查项和事件禁止通用创建或更新。
- 同一任务检查项规范化名称唯一，检查项数量为 1–100。
- 检查项结果更新同时使用任务版本和检查项版本。
- 执行人和复核人必须为不同稳定身份。
- 领域命令按权限、读取、身份、状态/条件、版本、SQL、事件/审计顺序失败关闭。
- 每个写命令在调用方事务内原子更新业务记录、事件和审计。
- UI 只能注册声明槽位，种子必须确定、匿名、引用一致。
- 不改动现有“开始生成.bat”行为。

---

### Task 1: 创建并验证生产蓝图片段

**Files:**
- Create: `engine/domain-packs/packs/inspection_rectification/catalog.json`
- Create: `engine/domain-packs/packs/inspection_rectification/blueprint.json`
- Create: `engine/domain-packs/packs/inspection_rectification/runtime/index.ts`
- Create: `engine/domain-packs/packs/inspection_rectification/ui/index.ts`
- Create: `engine/domain-packs/packs/inspection_rectification/seed/index.ts`
- Create: `engine/domain-packs/packs/inspection_rectification/tests/index.ts`
- Test: `engine/domain-packs/tests/integration/inspection-pack.test.ts`

**Interfaces:**
- Catalog provides `inspection.core` and declares `entity.detail.tabs`、`entity.detail.actions`、`dashboard.sections`。
- Fragment owns four entities, four modules, workflow `inspection_lifecycle` and four roles.
- Public points: `inspection_task.fields`、`inspection_task.relations`、`inspection_task.detail.tabs`、`inspection_task.create.sources`、`inspection_item.fields`、`inspection_item.relations`、`inspection.lifecycle.transitions`。

- [ ] **Step 1: 写生产包加载红灯测试**

测试加载真实目录、单独组合并断言四实体、四角色、四状态、五条迁移、七类事件、五项仪表盘指标、只追加历史和七个公开扩展点。

- [ ] **Step 2: 运行测试确认目录缺失**

Run: `node --import tsx --test tests/integration/inspection-pack.test.ts`

Expected: FAIL，原因是 `packs/inspection_rectification` 不存在。

- [ ] **Step 3: 创建严格目录和片段**

模块动作固定为：

```text
inspection_plans: list, view, create_plan, update_plan
inspection_tasks: list, view, create_task, assign, execute, submit, review
inspection_items: list, view, record_result
inspection_events: list, view
```

计划、任务、检查项均 `systemManaged: true`；事件为 `append_only + history + systemManaged`。任务初始化 `detailTabs: []` 和 `createSources: []`。

- [ ] **Step 4: 添加最小冻结入口并验证**

入口只导出冻结 ID/版本描述符，不打开数据库或网络。运行生产包测试、领域包类型检查和蓝图 55 项回归。

- [ ] **Step 5: 提交检查点**

```powershell
git add engine/domain-packs/packs/inspection_rectification engine/domain-packs/tests/integration/inspection-pack.test.ts
git commit -m "feat: add inspection rectification blueprint pack"
```

---

### Task 2: 实现计划配置和任务原子创建

**Files:**
- Create: `engine/domain-packs/packs/inspection_rectification/runtime/types.ts`
- Create: `engine/domain-packs/packs/inspection_rectification/runtime/inspection-service.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/index.ts`
- Create: `engine/domain-packs/tests/helpers/inspection-runtime.ts`
- Test: `engine/domain-packs/tests/integration/inspection-plan.test.ts`
- Test: `engine/domain-packs/tests/integration/inspection-create.test.ts`

**Interfaces:**

```ts
interface InspectionContext {
  connection: DatabaseSync;
  actor: InspectionActor;
  requirePermission(actor: InspectionActor, permission: string): void;
  appendAudit(connection: DatabaseSync, event: InspectionAuditEntry): void;
  identityHasRole(identityId: string, roleId: string, connection: DatabaseSync): boolean;
  archiveBlockers: readonly InspectionArchiveBlocker[];
  now(): Date;
  planCode(): string;
  taskCode(): string;
  itemCode(): string;
  eventCode(): string;
}

createPlan(request, context): InspectionPlanResult
updatePlan(request, context): InspectionPlanResult
createTask(request, context): InspectionTaskResult
```

- [ ] **Step 1: 写计划配置红灯测试**

覆盖正整数周期、计划编码唯一、管理员或计划人员身份、版本更新、通用 CRUD 拒绝和审计失败回滚。

- [ ] **Step 2: 写任务创建红灯测试**

从启用计划创建任务，携带 1–100 个 `{ name, standard }` 检查项，断言任务、检查项、`created` 事件和审计同事务保存。

- [ ] **Step 3: 写任务创建失败红灯测试**

覆盖停用/不存在计划、无效执行人、空标题、无效计划时间、空检查项、超过 100 项、规范化重名和中途审计失败整体回滚。

- [ ] **Step 4: 实现计划和任务创建**

名称规范化使用 `trim()`，重复判断区分大小写但忽略首尾空白。任务和所有检查项使用调用方编码器，写入固定 UTC 时间。

- [ ] **Step 5: 验证并提交**

```powershell
node --import tsx --test tests/integration/inspection-plan.test.ts tests/integration/inspection-create.test.ts
npm run typecheck
git add engine/domain-packs/packs/inspection_rectification/runtime engine/domain-packs/tests/helpers/inspection-runtime.ts engine/domain-packs/tests/integration/inspection-*.test.ts
git commit -m "feat: create inspection plans and tasks"
```

---

### Task 3: 实现分派、开始和检查项双版本记录

**Files:**
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/types.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/inspection-service.ts`
- Test: `engine/domain-packs/tests/integration/inspection-execution.test.ts`

**Interfaces:**

```ts
assignExecutor({ taskId, expectedTaskVersion, executorId, reason }, context): InspectionTaskResult
startTask({ taskId, expectedTaskVersion }, context): InspectionTaskResult
recordItemResult({
  taskId, itemId, expectedTaskVersion, expectedItemVersion,
  result: 'normal' | 'abnormal', finding, disposition
}, context): InspectionItemResult
```

- [ ] **Step 1: 写分派和开始红灯测试**

调整执行人只允许 `pending`；新执行人必须具有执行角色；只有当前执行人可开始并写入 `started_at`。

- [ ] **Step 2: 写正常结果红灯测试**

当前执行人在 `executing` 状态记录 `normal`，清空异常字段，同时递增任务和检查项版本并追加 `item_recorded` 事件和审计。

- [ ] **Step 3: 写异常结果红灯测试**

`abnormal` 必须同时提供非空 `finding` 和 `disposition`；成功后保留两字段和检查时间。

- [ ] **Step 4: 写双版本与归属拒绝红灯测试**

覆盖错误任务、检查项不属于任务、任务旧版本、检查项旧版本、非当前执行人和非执行状态。未经授权身份携带旧版本时必须先返回 `PERMISSION_DENIED`。

- [ ] **Step 5: 实现双条件事务更新**

先条件更新检查项 `WHERE id = ? AND version = ?`，再条件更新任务版本；任一变化数不是 1 时抛 `VERSION_CONFLICT`，由调用方回滚前一写入。

- [ ] **Step 6: 验证并提交**

```powershell
node --import tsx --test tests/integration/inspection-execution.test.ts
npm run typecheck
git add engine/domain-packs/packs/inspection_rectification/runtime engine/domain-packs/tests/integration/inspection-execution.test.ts
git commit -m "feat: execute inspection items atomically"
```

---

### Task 4: 实现提交、复核与归档阻断

**Files:**
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/types.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/inspection-service.ts`
- Test: `engine/domain-packs/tests/integration/inspection-lifecycle.test.ts`

**Interfaces:**

```ts
submitReview({ taskId, expectedTaskVersion }, context): InspectionTaskResult
rejectReview({ taskId, expectedTaskVersion, reason }, context): InspectionTaskResult
archiveTask({ taskId, expectedTaskVersion, comment }, context): InspectionTaskResult
```

- [ ] **Step 1: 写提交条件红灯测试**

有 `pending` 检查项时禁止提交；异常项缺少描述或处置时禁止提交；全部完成后写入 `submitted_at` 并进入 `pending_review`。

- [ ] **Step 2: 写复核分离红灯测试**

执行人本人复核必须 `PERMISSION_DENIED`；不同复核人可驳回到 `executing` 或归档到 `archived`。驳回清空当前 `submitted_at`，保留历史。

- [ ] **Step 3: 写归档阻断器红灯测试**

阻断器只在 `archiveTask` 执行；任一阻断返回 blocked 时抛 `INVALID_TRANSITION`，主状态、版本、时间和事件不变。

- [ ] **Step 4: 写后置失败回滚红灯测试**

让审计在归档主更新和事件写入后抛错，断言任务恢复 `pending_review`、版本和 `archived_at` 恢复、事件数不变。

- [ ] **Step 5: 实现生命周期命令**

按权限→读取→身份→状态/条件→版本执行。阻断器接收任务 ID 和当前事务连接，不得由核心服务打开新连接。

- [ ] **Step 6: 验证并提交**

```powershell
node --import tsx --test tests/integration/inspection-lifecycle.test.ts
npm run typecheck
git add engine/domain-packs/packs/inspection_rectification/runtime engine/domain-packs/tests/integration/inspection-lifecycle.test.ts
git commit -m "feat: complete inspection review lifecycle"
```

---

### Task 5: 汇总、仪表盘与写保护

**Files:**
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/inspection-service.ts`
- Test: `engine/domain-packs/tests/integration/inspection-summary.test.ts`
- Test: `engine/domain-packs/tests/integration/inspection-write-protection.test.ts`

**Interfaces:**

```ts
readTaskSummary(taskId, context): Readonly<{
  total: number; pending: number; normal: number; abnormal: number;
}>

readDashboardSummary(context): Readonly<{
  total: number; pending: number; executing: number;
  pendingReview: number; archived: number; abnormalItems: number;
}>
```

- [ ] **Step 1: 写任务汇总红灯测试**

使用真实检查项数据验证总数、待检查、正常和异常数量；读取方法要求 `inspection_tasks.view` 且不写数据库。

- [ ] **Step 2: 写动态仪表盘红灯测试**

创建四状态任务和异常项，验证任务状态与异常项总数；同一异常项只能计一次。

- [ ] **Step 3: 写通用仓储绕过红灯测试**

尝试通用创建/更新计划、任务、检查项和事件，全部返回 `PERMISSION_DENIED` 且 SQLite 无变化。

- [ ] **Step 4: 实现只读汇总并验证**

使用参数化聚合 SQL，不缓存当前状态。运行全部巡检集成测试、领域包和桌面类型检查。

- [ ] **Step 5: 提交检查点**

```powershell
git add engine/domain-packs/packs/inspection_rectification engine/domain-packs/tests/integration/inspection-summary.test.ts engine/domain-packs/tests/integration/inspection-write-protection.test.ts
git commit -m "feat: add inspection summaries and write protection"
```

---

### Task 6: 添加确定性种子

**Files:**
- Modify: `engine/domain-packs/packs/inspection_rectification/seed/index.ts`
- Test: `engine/domain-packs/tests/unit/inspection-seed.test.ts`

**Interfaces:**

```ts
generateInspectionSeed({ seed, planCount, taskCount }): InspectionSeed
```

- [ ] **Step 1: 写稳定性和边界红灯测试**

同参数字节稳定、不同 seed 输出不同；`seed` 为 32 位整数，`planCount` 为 1–50，`taskCount` 为 4–10000，无效值抛 `RangeError`。

- [ ] **Step 2: 写引用和状态一致性红灯测试**

每任务 2–6 项、编码唯一、引用有效、四状态覆盖；执行中及以后任务有开始时间，待复核及归档任务全部检查项完成，异常项字段完整，归档任务有归档时间和事件。

- [ ] **Step 3: 写匿名内容红灯测试**

序列化输出不含真实公司、人名或申请人占位符，身份只使用“计划岗位”“执行岗位”“复核岗位”编号。

- [ ] **Step 4: 实现固定 PRNG 和 UTC 时间轴**

使用包内 xorshift32，不使用 `Math.random`、当前时间或 locale 排序。事件序列必须与任务状态一致。

- [ ] **Step 5: 验证并提交**

```powershell
node --import tsx --test tests/unit/inspection-seed.test.ts
npm run typecheck
git add engine/domain-packs/packs/inspection_rectification/seed engine/domain-packs/tests/unit/inspection-seed.test.ts
git commit -m "feat: add deterministic inspection seed"
```

---

### Task 7: 注册插件、UI、扩展容器与验收

**Files:**
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/index.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/ui/index.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/tests/index.ts`
- Test: `engine/domain-packs/tests/unit/inspection-ui.test.ts`
- Test: `engine/domain-packs/tests/integration/inspection-pack-acceptance.test.ts`
- Test: `engine/domain-packs/tests/integration/inspection-extension.test.ts`

**Interfaces:**
- `inspectionRuntimeDescriptor` 实现全部固定钩子且拒绝未知配置。
- UI 注册检查项、异常处置、流转历史页签，任务操作组、计划操作组和动态仪表盘。
- `runInspectionAcceptanceScenario(dependencies)` 运行创建、开始、正常/异常记录、提交、驳回、重做、再次提交和归档。

- [ ] **Step 1: 写 UI 纯数据红灯测试**

槽位与 catalog 一致；描述符不含函数、数据库、IPC、登录、导航、维护或备份替换。

- [ ] **Step 2: 写插件加载红灯测试**

通过生产 `PluginRegistry` 和 `loadRuntimeBlueprint` 加载组合蓝图，捕获迁移、服务、明确 IPC、UI 和验收贡献；未知配置失败关闭。

- [ ] **Step 3: 写真实 SQLite 验收红灯测试**

完整流程至少产生创建、开始、两次结果、提交、驳回、重做结果、再次提交、归档事件；核对最终版本、事件、审计、任务汇总和仪表盘。

- [ ] **Step 4: 写真实依赖包扩展红灯测试**

使用已登记包身份通过 `inspection_task.detail.tabs`、`inspection_task.create.sources` 和 `inspection_item.fields` 追加严格描述，最终组合必须通过蓝图验证。

- [ ] **Step 5: 实现描述符和验收编排**

IPC 只注册计划、任务、检查项、复核和只读汇总命令，不提供任意 SQL、任意实体写入或通用执行入口。

- [ ] **Step 6: 验证并提交**

```powershell
npm run typecheck
npm test
git add engine/domain-packs/packs/inspection_rectification engine/domain-packs/tests
git commit -m "feat: complete inspection pack acceptance"
```

---

### Task 8: 文档、全量回归、审查与推送

**Files:**
- Create: `engine/domain-packs/packs/inspection_rectification/README.md`
- Modify: `engine/domain-packs/README.md`

- [ ] **Step 1: 编写维护文档**

记录四实体、状态迁移、计划周期、双版本更新、异常字段、角色、归档阻断、种子参数、公开扩展和两个桥接包职责。

- [ ] **Step 2: 运行领域包完成门槛**

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

重建后的自包含 CLI 必须再次构建无差异。

- [ ] **Step 3: 用 bundle CLI 组合生产包**

生成 `blueprint.json`、`domain-lock.json`、`composition-report.json`，再用 `engine/blueprint/cli.cjs` 复验蓝图。

- [ ] **Step 4: 运行全仓回归**

```powershell
npm --prefix engine run build:blueprint-validator
npm --prefix engine run test:blueprint
npm --prefix engine/desktop-runtime run typecheck
npm --prefix engine/desktop-runtime run test:unit
npm --prefix engine/desktop-runtime run test:integration
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

- [ ] **Step 5: 完成安全与产物检查**

检查 `git diff --check`，确认没有跟踪 `node_modules`、`dist`、临时目录、SQLite、EXE 或日志，并扫描 `ghp_`、`github_pat_`。

- [ ] **Step 6: 请求独立代码审查**

审查重点：通用写入绕过、计划周期、检查项重名、双版本事务、身份错误顺序、异常字段、复核分离、归档阻断、扩展容器和插件固定钩子。修复全部 Critical/Important 后重跑完整门槛。

- [ ] **Step 7: 提交并推送稳定检查点**

```powershell
git add engine/domain-packs docs/superpowers/plans/2026-09-18-inspection-rectification-pack.md
git commit -m "docs: document inspection rectification pack"
git push origin feature/next-update
```
