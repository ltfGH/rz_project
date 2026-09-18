# 库存与批次领域包实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 `inventory_batch@1.0.0`，实现物料、仓库、批次余额、不可变流水、入库、领用、退库、调整、效期预警和真实 SQLite 验收。

**Architecture:** 四实体核心包独立运行。所有配置和库存变化由 `InventoryService` 在调用方事务中执行；批次余额与流水、审计原子保存。审批、项目和资产关系留给桥接包。

**Tech Stack:** TypeScript 7、tsx、Node test runner、`node:sqlite`、现有组合器、蓝图验证器和插件协议。

**Spec:** `docs/superpowers/specs/2026-09-18-inventory-batch-design.md`

## Global Constraints

- ID/version：`inventory_batch@1.0.0`；蓝图 `1.0`；运行时 `1.0.0`。
- 只拥有 `material`、`warehouse`、`inventory_batch`、`inventory_transaction`。
- 四实体禁止通用写入；流水只追加。
- 数量有限且为正；余额永不为负；所有更新使用乐观版本。
- 退库累计量不得超过原领用量，且不修改原领用流水。
- seed 为无符号 32 位整数；UI 为纯数据；不改“开始生成.bat”。

---

### Task 1: 生产蓝图片段

**Files:** Create `engine/domain-packs/packs/inventory_batch/{catalog.json,blueprint.json,runtime/index.ts,ui/index.ts,seed/index.ts,tests/index.ts}`; Test `engine/domain-packs/tests/integration/inventory-pack.test.ts`。

**Interfaces:** 提供 `inventory.core`；四实体/四模块/四角色；公开 material、batch、transaction 字段/关系及 batch 页签/来源扩展点。

- [ ] 写加载与单包组合红灯测试，断言四实体、流水只追加、角色、仪表盘和扩展点。
- [ ] 运行测试确认目录缺失。
- [ ] 创建严格 catalog/fragment；模块只声明领域动作，不含通用 create/update。
- [ ] 添加最小冻结入口，运行类型检查、领域包和蓝图回归。
- [ ] 提交 `feat: add inventory batch blueprint pack`。

### Task 2: 物料和仓库配置

**Files:** Create `runtime/types.ts`, `runtime/inventory-service.ts`, `tests/helpers/inventory-runtime.ts`; Test `tests/integration/inventory-config.test.ts`。

**Interfaces:**
```ts
createMaterial/updateMaterial
createWarehouse/updateWarehouse
interface InventoryContext { connection; actor; requirePermission; appendAudit; identityHasRole; now; materialCode; warehouseCode; batchCode; transactionCode }
```

- [ ] 写单位非空、预警天数非负、仓库名称、身份/权限、版本、通用写保护和审计回滚红灯测试。
- [ ] 实现参数化 SQL 和领域审计，不自行打开事务。
- [ ] 运行聚焦测试和类型检查。
- [ ] 提交 `feat: add inventory configuration services`。

### Task 3: 首次与后续入库

**Files:** Modify runtime service/types; Test `tests/integration/inventory-receipt.test.ts`。

**Interfaces:**
```ts
receiveNewBatch({ materialCode, warehouseCode, batchNo, quantity, producedAt, receivedAt, expiresAt, reason }, context)
receiveExistingBatch({ batchId, expectedVersion, quantity, reason }, context)
```

- [ ] 写首次入库、后续入库和余额/流水/审计原子性红灯测试。
- [ ] 写重复组合、停用引用、非正数量、日期逆序、旧版本和后置失败回滚测试。
- [ ] 实现唯一组合检查、日期校验和版本条件更新。
- [ ] 提交 `feat: receive inventory batches atomically`。

### Task 4: 领用、退库和调整

**Files:** Modify runtime service/types; Test `tests/integration/inventory-movement.test.ts`。

**Interfaces:**
```ts
issueStock({ batchId, expectedVersion, quantity, reason }, context)
returnStock({ issueTransactionId, batchId, expectedVersion, quantity, reason }, context)
adjustStock({ batchId, expectedVersion, direction:'in'|'out', quantity, reason }, context)
```

- [ ] 写正常领用与非负余额红灯测试。
- [ ] 写退库引用、同批次、累计未退量和不可变原流水测试。
- [ ] 写正/负调整、非空原因、版本冲突和审计失败回滚测试。
- [ ] 实现余额条件更新和只追加流水。
- [ ] 提交 `feat: add inventory issue return and adjustment`。

### Task 5: 删除守卫、效期与汇总

**Files:** Modify runtime service; Test `tests/integration/inventory-rules.test.ts`。

**Interfaces:**
```ts
assertCanDeleteBatch(batchId, context)
readExpiryWarnings(context)
readInventorySummary(context)
```

- [ ] 写无流水可删、有流水拒绝红灯测试。
- [ ] 写无效期、正常、预警、到期边界测试。
- [ ] 写库存总量、批次数、预警/过期和近期流水汇总测试。
- [ ] 验证四实体通用写入全部拒绝。
- [ ] 提交 `feat: enforce inventory history and expiry rules`。

### Task 6: 确定性种子

**Files:** Modify `seed/index.ts`; Test `tests/unit/inventory-seed.test.ts`。

- [ ] 写同 seed 稳定、异 seed 不同、参数边界测试。
- [ ] 写引用、唯一编码、日期关系、四类效期和流水净额等于余额测试。
- [ ] 写匿名身份/内容测试。
- [ ] 实现 xorshift32 固定时间轴，提交 `feat: add deterministic inventory seed`。

### Task 7: 插件、UI、扩展与验收

**Files:** Modify runtime/ui/tests entrypoints; Test `tests/unit/inventory-ui.test.ts`, `tests/integration/inventory-pack-acceptance.test.ts`, `tests/integration/inventory-extension.test.ts`。

- [ ] 写 UI 槽位一致和纯数据红灯测试。
- [ ] 写 PluginRegistry/loadRuntimeBlueprint、固定钩子、未知配置失败测试。
- [ ] 用真实 SQLite 跑配置、入库、领用、部分退库、调整和汇总验收。
- [ ] 用磁盘完整依赖包覆盖公开扩展点并通过最终蓝图验证。
- [ ] 提交 `feat: complete inventory pack acceptance`。

### Task 8: 文档、全量门槛与推送

**Files:** Create `packs/inventory_batch/README.md`; Modify `engine/domain-packs/README.md`。

- [ ] 记录实体、事务、退库公式、效期、权限、种子和桥接边界。
- [ ] 运行 `npm ci`, typecheck, all tests, build；bundle CLI 组合生产包并复验蓝图。
- [ ] 运行蓝图、桌面和 `engine/tests/Run-All.ps1` 全回归。
- [ ] 扫描临时产物、SQLite/EXE/log、`ghp_`/`github_pat_` 和 `git diff --check`。
- [ ] 独立审查数量/版本/原子性/流水不可变/效期/扩展点，修复全部 Critical/Important。
- [ ] 提交 `docs: document inventory batch pack` 并推送 `feature/next-update`。
