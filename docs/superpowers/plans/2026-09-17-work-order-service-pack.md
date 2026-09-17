# 工单与服务领域包实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可独立组合的生产级 `work_order_service@1.0.0`，实现服务目录、SLA 固化、完整工单闭环、角色分离、事件审计、确定性种子和真实 SQLite 验收。

**Architecture:** 在 `engine/domain-packs/packs/work_order_service` 下实现独立目录、蓝图片段和固定插件入口。领域服务只使用调用方传入的 SQLite 事务、actor、权限门、身份解析、时钟、编码器和审计写入；工单、事件和 SLA 策略禁止通用写入，服务目录保留受权限控制的普通 CRUD。资产关联不进入本计划，后续由同时依赖 `asset.core` 和 `work_order.core` 的桥接包实现。

**Tech Stack:** TypeScript 7、Node test runner、tsx、`node:sqlite`、现有领域包组合器、蓝图验证器和桌面运行时插件注册协议。

**Spec:** `docs/superpowers/specs/2026-09-17-work-order-service-design.md`

## 全局约束

- 包 ID 和版本固定为 `work_order_service@1.0.0`。
- 兼容业务蓝图 `1.0` 和桌面运行时 `1.0.0`。
- 提供 `work_order.core`，不强制依赖 `asset.core`。
- 只拥有 `service_catalog`、`sla_policy`、`work_order`、`work_order_event` 四个实体。
- 工单状态固定为 `pending_dispatch`、`pending_acceptance`、`processing`、`pending_review`、`closed`。
- 工单状态、处理人、解决说明和节点时间只能由领域命令修改。
- `work_order_event` 只追加、系统管理，不开放通用写入。
- 领域命令使用乐观版本条件，并在调用方事务中同时写主记录、事件和审计。
- 处理人和复核人必须为不同稳定身份。
- SLA 截止时间在创建时固化，后续策略修改不影响历史工单。
- UI 只能注册声明的详情、操作和仪表盘槽位，不访问数据库或 IPC。
- 种子输出必须确定、匿名、引用一致。
- 不改动现有“开始生成.bat”行为。

---

### Task 1: 创建并验证生产蓝图片段

**Files:**
- Create: `engine/domain-packs/packs/work_order_service/catalog.json`
- Create: `engine/domain-packs/packs/work_order_service/blueprint.json`
- Create: `engine/domain-packs/packs/work_order_service/runtime/index.ts`
- Create: `engine/domain-packs/packs/work_order_service/ui/index.ts`
- Create: `engine/domain-packs/packs/work_order_service/seed/index.ts`
- Create: `engine/domain-packs/packs/work_order_service/tests/index.ts`
- Test: `engine/domain-packs/tests/integration/work-order-pack.test.ts`

**Interfaces:**
- Catalog provides `work_order.core`, requires no capability, and declares only `entity.detail.tabs`, `entity.detail.actions`, `dashboard.sections`.
- Fragment owns four entities, four modules, workflow `work_order_lifecycle` and four roles.
- Public extension points: `work_order.fields`, `work_order.relations`, `work_order.detail.tabs`, `work_order.lifecycle.transitions`, `work_order.create.sources`.

- [ ] **Step 1: 写生产包加载失败测试**

测试加载 `packs/work_order_service`，注册到 `PackRegistry`，单独组合后断言 `valid`、`canGenerate`，并检查四实体、四角色、五状态、七类事件、五项仪表盘指标和公开扩展点。

- [ ] **Step 2: 运行红灯测试**

Run: `node --import tsx --test tests/integration/work-order-pack.test.ts`

Expected: FAIL，原因是生产包目录不存在。

- [ ] **Step 3: 创建严格目录与蓝图片段**

蓝图模块动作必须按以下边界声明：

```text
service_catalogs: list, create, update, view
sla_policies: list, view, create_policy, update_policy
work_orders: list, view, create_order, dispatch, accept, add_processing_record, submit_resolution, review
work_order_events: list, view
```

`work_order` 使用 `protected`，`work_order_event` 使用 `append_only + history + systemManaged`。工单角色权限只能引用实际模块动作。

- [ ] **Step 4: 添加最小冻结入口并验证组合**

每个入口先导出冻结的 ID/版本描述符，不包含 SQL、脚本或网络调用。运行生产包测试和领域包类型检查。

- [ ] **Step 5: 提交检查点**

```powershell
git add engine/domain-packs/packs/work_order_service engine/domain-packs/tests/integration/work-order-pack.test.ts
git commit -m "feat: add work order service blueprint pack"
```

---

### Task 2: 实现工单创建与 SLA 固化

**Files:**
- Create: `packs/work_order_service/runtime/types.ts`
- Create: `packs/work_order_service/runtime/sla.ts`
- Create: `packs/work_order_service/runtime/work-order-service.ts`
- Modify: `packs/work_order_service/runtime/index.ts`
- Test: `tests/integration/work-order-create.test.ts`
- Test: `tests/unit/work-order-sla.test.ts`

**Interfaces:**

```ts
interface WorkOrderContext {
  connection: DatabaseSync;
  actor: WorkOrderActor;
  requirePermission(actor: WorkOrderActor, permission: string): void;
  appendAudit(connection: DatabaseSync, event: WorkOrderAuditEntry): void;
  identityHasRole(identityId: string, roleId: string, connection: DatabaseSync): boolean;
  now(): Date;
  orderCode(): string;
  eventCode(): string;
}

interface CreateWorkOrderRequest {
  title: string;
  description: string;
  serviceCode: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

class WorkOrderService {
  createSlaPolicy(request: CreateSlaPolicyRequest, context: WorkOrderContext): SlaPolicyResult;
  updateSlaPolicy(request: UpdateSlaPolicyRequest, context: WorkOrderContext): SlaPolicyResult;
  create(request: CreateWorkOrderRequest, context: WorkOrderContext): WorkOrderResult;
}
```

- [ ] **Step 1: 写 SLA 纯函数红灯测试**

覆盖正整数分钟计算、UTC ISO 输出、无效分钟拒绝，以及受理/关闭时间在截止时间之前、等于和之后的状态。

- [ ] **Step 2: 写真实 SQLite 创建红灯测试**

创建启用服务和唯一启用 SLA，执行 `create`，断言：状态为 `pending_dispatch`、版本为 1、两个截止时间准确、策略编码固化、创建事件和审计各一条。

- [ ] **Step 3: 写创建失败红灯测试**

覆盖停用服务、缺少 SLA、多条启用 SLA、无创建权限、空标题，以及审计失败后工单和事件全部回滚。

- [ ] **Step 4: 实现最小 SLA 和创建服务**

`sla.ts` 导出：

```ts
calculateDeadline(createdAt: Date, minutes: number): string
evaluateDeadline(actualAt: string | null, dueAt: string, now: Date): 'pending' | 'met' | 'overdue'
```

`create` 使用参数化 SQL，先读取服务和 SLA，再插入工单、事件并调用审计。服务不打开事务。

- [ ] **Step 5: 验证并提交**

Run: `node --import tsx --test tests/unit/work-order-sla.test.ts tests/integration/work-order-create.test.ts`

Run: `npm run typecheck`

```powershell
git add engine/domain-packs/packs/work_order_service/runtime engine/domain-packs/tests
git commit -m "feat: create work orders with fixed sla"
```

---

### Task 3: 实现派单、重新派单与受理

**Files:**
- Modify: `packs/work_order_service/runtime/types.ts`
- Modify: `packs/work_order_service/runtime/work-order-service.ts`
- Test: `tests/integration/work-order-dispatch.test.ts`

**Interfaces:**

```ts
dispatch({ workOrderId, expectedVersion, handlerId, reason }, context): WorkOrderResult
accept({ workOrderId, expectedVersion }, context): WorkOrderResult
```

- [ ] **Step 1: 写首次派单和重新派单红灯测试**

断言首次派单进入 `pending_acceptance`；重新派单保持该状态但更换处理人、增加版本、追加独立事件和审计。

- [ ] **Step 2: 写身份、权限和状态拒绝红灯测试**

覆盖不存在处理人、处理人无 `work_order_handler` 角色、无派单权限、关闭工单派单、非当前处理人受理和版本冲突。

- [ ] **Step 3: 写受理和响应 SLA 红灯测试**

当前处理人受理后进入 `processing`，固化 `accepted_at`；分别验证截止前和截止后受理的响应 SLA 结果。

- [ ] **Step 4: 实现显式迁移表与版本更新**

派单只接受 `pending_dispatch` 或 `pending_acceptance`；受理只接受 `pending_acceptance`。每次操作使用 `WHERE id = ? AND version = ?`，写入 `dispatched` 或 `accepted` 事件。

- [ ] **Step 5: 验证并提交**

```powershell
node --import tsx --test tests/integration/work-order-dispatch.test.ts
npm run typecheck
git add engine/domain-packs/packs/work_order_service/runtime engine/domain-packs/tests/integration/work-order-dispatch.test.ts
git commit -m "feat: add work order dispatch and acceptance"
```

---

### Task 4: 实现处理、提交与复核闭环

**Files:**
- Modify: `packs/work_order_service/runtime/types.ts`
- Modify: `packs/work_order_service/runtime/work-order-service.ts`
- Test: `tests/integration/work-order-lifecycle.test.ts`

**Interfaces:**

```ts
addProcessingRecord({ workOrderId, expectedVersion, content }, context): WorkOrderResult
submitResolution({ workOrderId, expectedVersion, resolution }, context): WorkOrderResult
rejectReview({ workOrderId, expectedVersion, reason }, context): WorkOrderResult
approveClose({ workOrderId, expectedVersion, comment }, context): WorkOrderResult
```

- [ ] **Step 1: 写处理记录红灯测试**

只有当前处理人可在 `processing` 状态追加非空记录；操作增加工单版本但不改变状态，并追加 `processing_recorded` 事件和审计。

- [ ] **Step 2: 写提交解决红灯测试**

没有处理记录时返回 `INVALID_TRANSITION`；存在记录时保存非空解决说明和 `submitted_at`，进入 `pending_review`。

- [ ] **Step 3: 写复核分离红灯测试**

处理人本人复核必须失败；具有复核权限的不同身份可驳回到 `processing` 或关闭到 `closed`。驳回保留历史并允许再次处理、提交。

- [ ] **Step 4: 写后置失败回滚红灯测试**

让审计在主记录和事件写入后抛错，断言状态、版本、解决说明、关闭时间和事件数量全部恢复。

- [ ] **Step 5: 实现闭环命令**

所有命令先校验权限，再校验 actor 与 `handler_id`、状态和版本；`approveClose` 额外校验 actor 与处理人不同。

- [ ] **Step 6: 验证并提交**

```powershell
node --import tsx --test tests/integration/work-order-lifecycle.test.ts
npm run typecheck
git add engine/domain-packs/packs/work_order_service/runtime engine/domain-packs/tests/integration/work-order-lifecycle.test.ts
git commit -m "feat: complete work order lifecycle"
```

---

### Task 5: SLA 状态、仪表盘与通用写入保护

**Files:**
- Modify: `packs/work_order_service/runtime/work-order-service.ts`
- Test: `tests/integration/work-order-sla-status.test.ts`
- Test: `tests/integration/work-order-write-protection.test.ts`

**Interfaces:**

```ts
readSlaStatus(workOrderId: number, context: WorkOrderContext): Readonly<{
  response: 'pending' | 'met' | 'overdue';
  resolution: 'pending' | 'met' | 'overdue';
}>;
```

- [ ] **Step 1: 写 SLA 状态红灯测试**

覆盖未受理未超时、未受理已超时、按时受理、超时受理、未关闭已超时、按时关闭和超时关闭。

- [ ] **Step 2: 写通用仓储绕过红灯测试**

通过真实 `EntityRepository` 尝试通用创建/更新 `work_order` 以及创建/更新 `work_order_event`，全部应返回 `PERMISSION_DENIED` 且 SQLite 无变化。

- [ ] **Step 3: 验证仪表盘定义**

使用 `DashboardService` 创建不同状态工单，断言总数、待处理、待复核、已关闭指标。当前超时指标由插件仪表盘贡献读取 `readSlaStatus`，不以静态蓝图过滤冒充动态时间计算。

- [ ] **Step 4: 实现 SLA 读取并验证**

读取方法只查询工单并使用注入时钟，不写数据库。运行全部工单集成测试和类型检查。

- [ ] **Step 5: 提交检查点**

```powershell
git add engine/domain-packs/packs/work_order_service engine/domain-packs/tests
git commit -m "feat: enforce work order sla and write protection"
```

---

### Task 6: 添加确定性种子

**Files:**
- Modify: `packs/work_order_service/seed/index.ts`
- Test: `tests/unit/work-order-seed.test.ts`

**Interfaces:**

```ts
generateWorkOrderSeed({ seed, serviceCount, orderCount }): WorkOrderSeed
```

- [ ] **Step 1: 写种子红灯测试**

断言同参数字节稳定、不同 seed 输出不同、数量准确、编码唯一、所有引用有效、五种状态均覆盖、状态与事件/时间节点一致，并且无真实企业或个人身份。

- [ ] **Step 2: 写参数边界红灯测试**

`seed` 为 32 位整数，`serviceCount` 为 1–50，`orderCount` 为 5–10000；无效值抛 `RangeError`。

- [ ] **Step 3: 实现固定 PRNG 和 UTC 时间轴**

复用资产包的 xorshift32 思路但保持包内独立实现；不使用 `Math.random`、当前时间或 locale 排序。为每个服务生成四个优先级 SLA。

- [ ] **Step 4: 验证并提交**

```powershell
node --import tsx --test tests/unit/work-order-seed.test.ts
npm run typecheck
git add engine/domain-packs/packs/work_order_service/seed engine/domain-packs/tests/unit/work-order-seed.test.ts
git commit -m "feat: add deterministic work order seed"
```

---

### Task 7: 注册插件、UI 与真实验收场景

**Files:**
- Modify: `packs/work_order_service/runtime/index.ts`
- Modify: `packs/work_order_service/ui/index.ts`
- Modify: `packs/work_order_service/tests/index.ts`
- Test: `tests/unit/work-order-ui.test.ts`
- Test: `tests/integration/work-order-pack-acceptance.test.ts`

**Interfaces:**
- `workOrderRuntimeDescriptor` 实现全部必需插件钩子且拒绝未知配置。
- UI 注册处理记录、流转历史、SLA 状态三个页签，状态操作组和仪表盘区。
- `runWorkOrderAcceptanceScenario(dependencies)` 使用注入服务运行完整闭环。

- [ ] **Step 1: 写 UI 描述符红灯测试**

断言槽位与 catalog 完全一致、描述符为纯数据、没有函数、数据库、IPC、登录、导航、维护或备份替换。

- [ ] **Step 2: 写插件加载红灯测试**

组合生产包后，通过 `PluginRegistry.register(workOrderRuntimeDescriptor)` 和 `loadRuntimeBlueprint` 加载；激活后捕获迁移、服务、IPC、UI 和验收贡献。缺失或未知配置必须失败。

- [ ] **Step 3: 写真实 SQLite 端到端红灯测试**

创建配置，运行创建、派单、受理、处理、提交、驳回、再次处理、再次提交、关闭，核对最终版本、事件序列、审计数量、SLA 和仪表盘。

- [ ] **Step 4: 实现描述符和验收编排**

注册的 IPC 贡献只描述明确领域命令，不提供任意 SQL、任意实体写入或通用执行入口。

- [ ] **Step 5: 验证并提交**

```powershell
npm run typecheck
npm test
git add engine/domain-packs/packs/work_order_service engine/domain-packs/tests
git commit -m "feat: complete work order pack acceptance"
```

---

### Task 8: 文档、全量回归与稳定推送

**Files:**
- Create: `packs/work_order_service/README.md`
- Modify: `engine/domain-packs/README.md`

- [ ] **Step 1: 编写维护文档**

记录实体、状态迁移、权限、身份解析、SLA 公式、种子参数、公开扩展点、独立使用边界和后续资产桥接职责。

- [ ] **Step 2: 运行领域包完整门槛**

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

重建后的 `bin/domain-pack-cli.cjs` 必须提交且再次构建无差异。

- [ ] **Step 3: 用 bundle CLI 组合生产工单包**

生成 `blueprint.json`、`domain-lock.json`、`composition-report.json`，再用 `engine/blueprint/cli.cjs` 验证生成蓝图。

- [ ] **Step 4: 运行全仓回归**

```powershell
npm --prefix engine run test:blueprint
npm --prefix engine/desktop-runtime run typecheck
npm --prefix engine/desktop-runtime run test:unit
npm --prefix engine/desktop-runtime run test:integration
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

- [ ] **Step 5: 完成安全与产物检查**

确认没有跟踪 `node_modules`、`dist`、临时目录、SQLite、EXE 或日志；扫描 `ghp_`、`github_pat_`；运行 `git diff --check`。

- [ ] **Step 6: 请求独立代码审查**

审查重点：通用写入绕过、处理/复核分离、SLA 固化、身份验证、事务回滚、跨包所有权和插件固定钩子。修复全部 Critical/Important 后重跑完整门槛。

- [ ] **Step 7: 提交并推送稳定检查点**

```powershell
git add engine/domain-packs docs/superpowers/plans/2026-09-17-work-order-service-pack.md
git commit -m "docs: document work order service pack"
git push origin feature/next-update
```
