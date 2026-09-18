# 项目与任务领域包实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付生产级 `project_task@1.0.0`，实现项目、里程碑、加权任务、风险、多版本交付物、只追加事件、关闭复核和真实 SQLite 验收。

**Architecture:** 六实体核心包独立运行，全部业务写入由单一 `ProjectService` 对外暴露；内部按项目、任务、风险/交付和查询职责拆分。服务只使用调用方注入的 SQLite 事务、actor、权限门、身份解析、只读关闭阻断器、时钟、编码器和审计，任务变化与项目派生进度、事件、审计原子保存。

**Tech Stack:** TypeScript 7、tsx、Node test runner、`node:sqlite`、现有领域包组合器、蓝图验证器和桌面运行时插件协议。

**Spec:** `docs/superpowers/specs/2026-09-18-project-task-design.md`

## Global Constraints

- ID/version：`project_task@1.0.0`；蓝图 `1.0`；运行时 `1.0.0`；能力 `project.core`。
- 只拥有 `project`、`milestone`、`project_task`、`project_risk`、`deliverable`、`project_event`。
- 六实体禁止通用写入；`project_event` 为 `append_only + history + systemManaged`。
- 项目进度只由未取消任务权重派生，保留两位小数，不允许外部写入。
- 交付业务版本提交后内容不可修改，只允许一次验收或驳回。
- 项目关闭要求独立复核；关闭后全部领域对象只读。
- 任何状态、派生进度、事件和审计必须在调用方同一 SQLite 事务内保存。
- seed 使用无符号 32 位整数、固定时钟和匿名岗位；UI 只包含纯数据。

---

### Task 1: 生产蓝图片段与最小入口

**Files:**
- Create: `engine/domain-packs/packs/project_task/catalog.json`
- Create: `engine/domain-packs/packs/project_task/blueprint.json`
- Create: `engine/domain-packs/packs/project_task/runtime/index.ts`
- Create: `engine/domain-packs/packs/project_task/ui/index.ts`
- Create: `engine/domain-packs/packs/project_task/seed/index.ts`
- Create: `engine/domain-packs/packs/project_task/tests/index.ts`
- Test: `engine/domain-packs/tests/integration/project-pack.test.ts`

**Interfaces:**
- Produces capability `project.core` and exact entrypoints `runtime/index.ts`, `ui/index.ts`, `seed/index.ts`, `tests/index.ts`.
- Produces entities/modules with IDs `project/projects`, `milestone/milestones`, `project_task/project_tasks`, `project_risk/project_risks`, `deliverable/deliverables`, `project_event/project_events`.
- Produces roles `project_member`, `project_manager`, `project_reviewer`, `project_admin`.

- [ ] **Step 1: Write the failing production-pack test**

```ts
test('loads and composes production project task pack', () => {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'project_task'));
  const registry = new PackRegistry(); registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion:'1.0', runtimeVersion:'1.0.0',
    software:{ id:'project_app', name:'离线项目任务管理软件', version:'1.0.0',
      purpose:'管理项目交付闭环', targetUsers:['项目岗位'], boundaries:['离线'], loginMode:'required' },
    selections:[{ id:'project_task', version:'1.0.0', config:{} }],
    coverage:{ supported:['项目任务'], unsupported:[] },
    materials:{ developmentPurpose:'项目交付', industry:'企业管理', technicalFeatures:['SQLite事务'] }
  }, registry);
  assert.equal(result.canGenerate, true, result.summary);
  const blueprint = result.blueprint as any;
  assert.deepEqual(blueprint.entities.map((x:any) => x.id), [
    'project','milestone','project_task','project_risk','deliverable','project_event'
  ]);
  assert.equal(blueprint.roles.length, 4);
  assert.equal(blueprint.modules.length, 6);
  assert.equal(blueprint.entities.every((x:any) => x.systemManaged), true);
  assert.equal(blueprint.entities.find((x:any) => x.id === 'project_event').retention, 'append_only');
});
```

- [ ] **Step 2: Run the test and confirm it fails because the pack directory is absent**

Run: `node --import tsx --test tests/integration/project-pack.test.ts` from `engine/domain-packs`.

Expected: FAIL mentioning missing `packs/project_task/catalog.json`.

- [ ] **Step 3: Add the strict catalog and blueprint fragment**

The fragment must declare explicit fields from the spec, empty `extensions`, exact ownership, four roles, six modules with domain actions only, dynamic-dashboard-compatible base counters, and these public extension points:

```json
[
  "project.fields", "project.relations", "project.detail.tabs", "project.create.sources",
  "project_task.fields", "project_task.relations", "project_task.detail.tabs", "project_task.create.sources",
  "project_risk.fields", "project_risk.relations",
  "deliverable.fields", "deliverable.relations"
]
```

Initialize `detailTabs: []` and `createSources: []` on project and task. Modules must not expose generic `create`, `update` or `delete` actions.

- [ ] **Step 4: Add frozen minimal entrypoint descriptors and verify the pack**

```ts
export const projectRuntimeDescriptor = Object.freeze({ id:'project_task', version:'1.0.0' });
export const projectUiDescriptor = Object.freeze({ id:'project_task', version:'1.0.0' });
export const projectSeedDescriptor = Object.freeze({ id:'project_task', version:'1.0.0' });
export const projectAcceptanceDescriptor = Object.freeze({ id:'project_task', version:'1.0.0' });
```

Run: `npm run typecheck && node --import tsx --test tests/integration/project-pack.test.ts && node --test ../tests/blueprint/*.test.js`.

Expected: project test PASS; blueprint 55/55 PASS.

- [ ] **Step 5: Commit**

```powershell
git add engine/domain-packs/packs/project_task engine/domain-packs/tests/integration/project-pack.test.ts
git commit -m "feat: add project task blueprint pack"
```

---

### Task 2: 项目配置、激活与基础运行时

**Files:**
- Create: `engine/domain-packs/packs/project_task/runtime/types.ts`
- Create: `engine/domain-packs/packs/project_task/runtime/project-service.ts`
- Create: `engine/domain-packs/packs/project_task/runtime/project-internals.ts`
- Create: `engine/domain-packs/tests/helpers/project-runtime.ts`
- Test: `engine/domain-packs/tests/integration/project-config.test.ts`

**Interfaces:**
- `ProjectContext { connection; actor; requirePermission; appendAudit; identityHasRole; closeBlockers; now; projectCode; milestoneCode; taskCode; riskCode; deliverableCode; eventCode }`
- `ProjectService.createProject(request, context)`
- `ProjectService.updateProject(request, context)`
- `ProjectService.activateProject(request, context)`
- `ProjectService.createMilestone(request, context)`
- Internal helpers `readProject`, `appendProjectEvent`, `assertProjectManager`, `strictDate`, `required`.

- [ ] **Step 1: Write failing project configuration tests**

Cover successful create/update/activate/create milestone, strict dates, `plannedStartAt <= plannedEndAt`, valid manager identity, manager/admin identity, optimistic versions, event/audit counts and audit failure rollback.

```ts
const created = database.transaction(c => service.createProject({
  name:'验收项目', managerId:manager.username,
  plannedStartAt:'2026-09-20', plannedEndAt:'2026-12-31'
}, projectContext(c, manager)));
assert.deepEqual(created, { projectId:1, projectCode:created.projectCode,
  status:'planning', progress:0, version:1 });
```

- [ ] **Step 2: Run tests and verify missing service/types failures**

Run: `node --import tsx --test tests/integration/project-config.test.ts`.

Expected: FAIL importing `ProjectService`.

- [ ] **Step 3: Implement focused shared helpers and context types**

`project-internals.ts` owns validation, reads, event append and frozen result builders. Identifier interpolation is forbidden except a strict read-only blocker helper added in Task 5. Date parsing must round-trip ISO `YYYY-MM-DD`, rejecting `2026-02-30`.

- [ ] **Step 4: Implement project and milestone commands**

Use `WHERE id=? AND version=?` for updates. `updateProject` is planning-only; managers may edit name/dates, admins may also change manager to a valid `project_manager`. `activateProject` transitions planning to active. `createMilestone` accepts planning or active projects and requires a nonempty name and strict due date within project plan dates.

- [ ] **Step 5: Protect generic writes and transaction rollback**

For every entity, assert `EntityRepository.create/update` returns `PERMISSION_DENIED`. Inject an audit function that throws and assert project/milestone/event row counts remain unchanged after transaction rollback.

- [ ] **Step 6: Run focused and type checks**

Run: `npm run typecheck && node --import tsx --test tests/integration/project-config.test.ts`.

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add engine/domain-packs/packs/project_task/runtime engine/domain-packs/tests/helpers/project-runtime.ts engine/domain-packs/tests/integration/project-config.test.ts
git commit -m "feat: add project configuration lifecycle"
```

---

### Task 3: 任务闭环与加权进度

**Files:**
- Create: `engine/domain-packs/packs/project_task/runtime/task-commands.ts`
- Modify: `engine/domain-packs/packs/project_task/runtime/project-service.ts`
- Modify: `engine/domain-packs/packs/project_task/runtime/types.ts`
- Test: `engine/domain-packs/tests/integration/project-task-lifecycle.test.ts`
- Test: `engine/domain-packs/tests/integration/project-progress.test.ts`

**Interfaces:**
- `createTask({ projectId, milestoneCode, title, description, assigneeId, weight, required }, context)`
- `updatePendingTask({ taskId, expectedVersion, ...editableFields }, context)`
- `startTask({ taskId, expectedVersion }, context)`
- `addTaskProgress({ taskId, expectedVersion, note }, context)`
- `submitTaskReview({ taskId, expectedVersion }, context)`
- `rejectTaskReview({ taskId, expectedVersion, reason }, context)`
- `approveTask({ taskId, expectedVersion, comment }, context)`
- `cancelTask({ taskId, expectedVersion, reason }, context)`
- `restoreTask({ taskId, expectedVersion, reason }, context)`
- Internal `recalculateProjectProgress(projectCode, context): number`.

- [ ] **Step 1: Write the failing happy-path task test**

```ts
const tx = <T>(run:(connection:DatabaseSync)=>T) => database.transaction(run);
const ctx = projectContext;
const task = tx(c => service.createTask({ projectId, milestoneCode:null,
  title:'完成部署', description:'离线部署', assigneeId:member.username,
  weight:40, required:true }, ctx(c, manager)));
let current = tx(c => service.startTask({ taskId:task.taskId, expectedVersion:1 }, ctx(c, member)));
current = tx(c => service.addTaskProgress({ taskId:task.taskId,
  expectedVersion:current.version, note:'已完成安装验证' }, ctx(c, member)));
current = tx(c => service.submitTaskReview({ taskId:task.taskId,
  expectedVersion:current.version }, ctx(c, member)));
const done = tx(c => service.approveTask({ taskId:task.taskId,
  expectedVersion:current.version, comment:'通过' }, ctx(c, manager)));
assert.equal(done.status, 'completed');
```

Assert each command appends an event/audit and the completed task updates project progress in the same transaction.

- [ ] **Step 2: Write failing authorization/state/version tests**

Cover inactive project, invalid assignee, nonpositive/unsafe weight, wrong current assignee, manager self-review when also assignee, empty progress/reason/comment, stale version, completed immutability, and unauthorized state/version ordering.

- [ ] **Step 3: Implement task commands with exact state transitions**

Commands read task plus project, enforce project `active`, identity ownership, state, then version. `addTaskProgress` keeps `in_progress` but increments version and appends `progress_added`.

- [ ] **Step 4: Implement deterministic weighted progress**

```sql
SELECT COALESCE(SUM(weight),0) total_weight,
       COALESCE(SUM(CASE WHEN status='completed' THEN weight ELSE 0 END),0) completed_weight
FROM biz_project_task WHERE project_code=? AND status!='cancelled'
```

Compute zero for no effective tasks, otherwise `Math.round(completed/total*10000)/100`. Update project progress and project version in the same command transaction without accepting external progress.

- [ ] **Step 5: Test cancellation/restoration and rollback**

Create weights 30/70; complete the 30 task and assert 30%. Cancel the 70 task and assert 100%; restore it and assert 30%. Inject failure after the progress update and assert task, project, event and audit all roll back.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm run typecheck && node --import tsx --test tests/integration/project-task-lifecycle.test.ts tests/integration/project-progress.test.ts`.

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add engine/domain-packs/packs/project_task/runtime engine/domain-packs/tests/integration/project-task-lifecycle.test.ts engine/domain-packs/tests/integration/project-progress.test.ts
git commit -m "feat: add project task lifecycle and progress"
```

---

### Task 4: 风险、交付版本与里程碑完成

**Files:**
- Create: `engine/domain-packs/packs/project_task/runtime/support-commands.ts`
- Modify: `engine/domain-packs/packs/project_task/runtime/project-service.ts`
- Modify: `engine/domain-packs/packs/project_task/runtime/types.ts`
- Test: `engine/domain-packs/tests/integration/project-risk.test.ts`
- Test: `engine/domain-packs/tests/integration/project-deliverable.test.ts`
- Test: `engine/domain-packs/tests/integration/project-milestone.test.ts`

**Interfaces:**
- `createRisk`, `mitigateRisk`, `closeRisk`, `reopenRisk`
- `submitDeliverable`, `reviewDeliverable`
- `completeMilestone({ milestoneId, expectedVersion, comment }, context)`

- [ ] **Step 1: Write failing risk workflow tests**

Cover all three levels, open→mitigated→closed, mitigated/closed→open, mandatory disposition, member ownership, reviewer-only close, stale version and audit rollback.

- [ ] **Step 2: Implement risk commands**

Only active projects accept risk writes. `closeRisk` requires `project_reviewer`; reopen requires manager or reviewer. Every transition conditionally updates the risk, appends a subject event and writes audit.

- [ ] **Step 3: Write failing immutable deliverable-version tests**

```ts
const submit = (businessVersion:string, digest:string) => database.transaction(c =>
  service.submitDeliverable({ projectId, milestoneCode:null, deliverableKey:'manual',
    name:'用户手册', businessVersion, required:true,
    fileName:`manual-${businessVersion}.pdf`, fileDigest:digest }, projectContext(c, member)));
const review = (deliverableId:number, expectedVersion:number, decision:'accepted'|'rejected', comment:string) =>
  database.transaction(c => service.reviewDeliverable({ deliverableId, expectedVersion,
    decision, comment }, projectContext(c, manager)));
const v1 = submit('1.0','sha256:one');
review(v1.deliverableId, v1.version, 'rejected', '补充验收记录');
const v2 = submit('1.1','sha256:two');
review(v2.deliverableId, v2.version, 'accepted', '通过');
const oldVersion = database.prepare('SELECT status,file_digest FROM biz_deliverable WHERE id=?')
  .get(v1.deliverableId) as { status:string; file_digest:string };
assert.deepEqual(oldVersion, { status:'rejected', file_digest:'sha256:one' });
```

Also cover duplicate business version, blank digest/name, submitter self-review, second review attempt and generic update denial.

- [ ] **Step 4: Implement submit/review without content overwrite**

`submitDeliverable` inserts a new row with version 1. `reviewDeliverable` only updates status/reviewer/comment/version from submitted version 1 to accepted/rejected version 2; SQL never updates name, key, business version, file metadata or required flag.

- [ ] **Step 5: Write and implement milestone completion blockers**

Tests create one required incomplete task and one required deliverable whose latest version is rejected; each independently blocks completion. After completing the task and accepting a newer deliverable version, completion succeeds with versioned event/audit. Optional tasks/deliverables do not block.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm run typecheck && node --import tsx --test tests/integration/project-risk.test.ts tests/integration/project-deliverable.test.ts tests/integration/project-milestone.test.ts`.

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add engine/domain-packs/packs/project_task/runtime engine/domain-packs/tests/integration/project-risk.test.ts engine/domain-packs/tests/integration/project-deliverable.test.ts engine/domain-packs/tests/integration/project-milestone.test.ts
git commit -m "feat: add project risk and delivery controls"
```

---

### Task 5: 关闭复核、只读阻断器与动态汇总

**Files:**
- Create: `engine/domain-packs/packs/project_task/runtime/project-queries.ts`
- Modify: `engine/domain-packs/packs/project_task/runtime/project-service.ts`
- Modify: `engine/domain-packs/packs/project_task/runtime/project-internals.ts`
- Modify: `engine/domain-packs/packs/project_task/runtime/types.ts`
- Test: `engine/domain-packs/tests/integration/project-close.test.ts`
- Test: `engine/domain-packs/tests/integration/project-summary.test.ts`

**Interfaces:**
- `ProjectCloseBlocker(projectId, readConnection) => { blocked, code, message }`
- `requestProjectClose`, `rejectProjectClose`, `approveProjectClose`
- `readProjectSummary(projectId, context)`
- `readProjectDashboard(context)`

- [ ] **Step 1: Write one failing test per close condition**

Independently assert incomplete milestone, required task, rejected latest required deliverable, open high risk, untreated open medium/low risk, blocker response, stale version and audit failure prevent transition and add no close event.

- [ ] **Step 2: Add the frozen read-only blocker facade**

Expose only:

```ts
find(entityId:string, filters:Readonly<Record<string,string|number|null>>)
  : readonly Readonly<Record<string,unknown>>[]
```

Validate identifiers with `/^[a-z][a-z0-9_]{1,63}$/`, limit filters to 20, bind all values, issue only `SELECT`, freeze row copies, and never expose `prepare`, `exec` or `DatabaseSync`.

- [ ] **Step 3: Implement request/reject/approve close**

`requestProjectClose` follows the nine-condition order from the spec and transitions active→pending_close. `rejectProjectClose` requires reviewer and returns pending_close→active. `approveProjectClose` requires reviewer, rejects `actor.username === close_requested_by`, and transitions to closed. All three append event and audit atomically.

- [ ] **Step 4: Write failing project/detail and dashboard summary tests**

Use injected date `2026-09-18` and create exact boundary cases for overdue project/milestone, pending-review task, open high risk and submitted deliverable. Assert closed/completed records are not overdue and equality to due date is not overdue.

- [ ] **Step 5: Implement parameterized live summaries**

`readProjectSummary` returns task counts, weighted progress, milestone/risk/deliverable counts. `readProjectDashboard` returns project statuses, overdue projects, overdue milestones, pending task reviews, open high risks and pending deliverables from current SQLite state without caches.

- [ ] **Step 6: Verify closed-project immutability**

Attempt every project/task/risk/deliverable write against a closed project and assert `INVALID_TRANSITION`, no row/event/audit changes.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm run typecheck && node --import tsx --test tests/integration/project-close.test.ts tests/integration/project-summary.test.ts`.

```powershell
git add engine/domain-packs/packs/project_task/runtime engine/domain-packs/tests/integration/project-close.test.ts engine/domain-packs/tests/integration/project-summary.test.ts
git commit -m "feat: enforce project closure and summaries"
```

---

### Task 6: 确定性项目种子

**Files:**
- Modify: `engine/domain-packs/packs/project_task/seed/index.ts`
- Test: `engine/domain-packs/tests/unit/project-seed.test.ts`

**Interfaces:**
- `generateProjectSeed({ seed, projectCount, tasksPerProject })`
- Bounds: `seed 0..0xffffffff`, `projectCount 4..50`, `tasksPerProject 3..100`.

- [ ] **Step 1: Write failing deterministic and bounds tests**

Assert equal input is byte-stable, different seeds differ, exact entity counts hold, invalid bounds throw `RangeError`, and serialized output contains no real company/person/applicant labels.

- [ ] **Step 2: Write failing consistency tests**

For every project assert references exist, task weights are positive, progress matches the exact formula, status timestamps align, milestones satisfy their represented state, latest required deliverable status aligns, risks cover all levels, and events reference existing subjects.

- [ ] **Step 3: Implement xorshift32 generation using a fixed base instant**

Generate all six record arrays with stable code ordering. Include all project/task statuses, reject/rework event chains, cancelled tasks, three risk levels and rejected-v1/accepted-v2 deliverable chains. Freeze all returned rows and arrays.

- [ ] **Step 4: Run tests and commit**

Run: `npm run typecheck && node --import tsx --test tests/unit/project-seed.test.ts`.

```powershell
git add engine/domain-packs/packs/project_task/seed/index.ts engine/domain-packs/tests/unit/project-seed.test.ts
git commit -m "feat: add deterministic project seed"
```

---

### Task 7: 插件、UI、真实扩展包与端到端验收

**Files:**
- Modify: `engine/domain-packs/packs/project_task/runtime/index.ts`
- Modify: `engine/domain-packs/packs/project_task/ui/index.ts`
- Modify: `engine/domain-packs/packs/project_task/tests/index.ts`
- Create: `engine/domain-packs/tests/unit/project-ui.test.ts`
- Create: `engine/domain-packs/tests/integration/project-pack-acceptance.test.ts`
- Create: `engine/domain-packs/tests/integration/project-extension.test.ts`
- Create: `engine/domain-packs/tests/fixtures/packs/project-archive-bridge/**`

**Interfaces:**
- Plugin service ID `project.lifecycle`.
- Acceptance ID `project.lifecycle.acceptance`.
- Config must be exactly `{}`.
- UI slots exactly catalog `uiSlots` and descriptors contain no functions.

- [ ] **Step 1: Write failing UI purity and plugin fixed-hook tests**

Assert exact config rejection, migration `project_task.v1`, one service factory, explicit IPC method list, all UI contributions and one acceptance scenario. Compare the full ordered contribution list rather than checking only one ID.

- [ ] **Step 2: Implement production plugin and pure UI descriptors**

Register every public command/read method with its exact module permission. UI contributes project tabs, task tabs, action groups and one dynamic dashboard section pointing to `project.dashboard_summary`.

- [ ] **Step 3: Write the real SQLite acceptance scenario**

Use production composition, `PluginRegistry`, `loadRuntimeBlueprint`, compiled schema, real permissions/audit and injected identities. Execute the full flow from the spec including task reject/rework, deliverable reject/new version, high-risk close, milestone complete, independent project close, then assert final progress/status/version, immutable old delivery, event and audit counts.

- [ ] **Step 4: Add a complete on-disk archive bridge fixture**

The fixture provides `archive.core`, requires `project.core`, owns one `archive_record` entity, and uses every public project/task/risk/deliverable extension point with valid reference fields/relations plus project/task tabs and creation sources.

- [ ] **Step 5: Compose the real base and fixture and validate final blueprint**

Assert the fixture loads through `loadPack`, dependency resolution succeeds, all appended containers exist and the final composed blueprint passes the existing validator.

- [ ] **Step 6: Run project, domain and blueprint gates and commit**

Run:

```powershell
node --import tsx --test tests/unit/project-*.test.ts tests/integration/project-*.test.ts
npm run typecheck
node --test ../tests/blueprint/*.test.js
```

Expected: all project tests, typecheck and blueprint 55/55 PASS.

```powershell
git add engine/domain-packs/packs/project_task engine/domain-packs/tests
git commit -m "feat: complete project pack acceptance"
```

---

### Task 8: 文档、独立审查、全量门槛与推送

**Files:**
- Create: `engine/domain-packs/packs/project_task/README.md`
- Modify: `engine/domain-packs/README.md`

- [ ] **Step 1: Document the production contract**

Record six entities, progress formula, task/project states, milestone and close conditions, immutable delivery versions, roles, blocker read boundary, seed options, UI and bridge responsibilities. Do not claim file storage, budget or scheduling capabilities.

- [ ] **Step 2: Run fresh domain-pack gates**

```powershell
npm run typecheck
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run shared regressions**

```powershell
node --test engine\tests\blueprint\*.test.js
Set-Location engine\desktop-runtime
npm run typecheck
npm run test:unit
npm run test:integration
Set-Location ..\..
powershell -NoProfile -ExecutionPolicy Bypass -File .\engine\tests\Run-All.ps1
```

Expected: blueprint 55/55, desktop runtime 20 unit + 29 integration, PowerShell exit 0.

- [ ] **Step 4: Build and validate a production CLI composition**

Use a temporary request selecting the real `packs/project_task`, run checked-in `bin/domain-pack-cli.cjs`, verify exactly `blueprint.json`, `domain-lock.json`, `composition-report.json`, then run `engine/blueprint/cli.cjs --input <blueprint>` and require `valid=true`, `canGenerate=true`. Remove temporary request/output afterward.

- [ ] **Step 5: Scan repository hygiene**

Run `git diff --check`, scan tracked files for SQLite/DB/log/EXE/temp askpass artifacts, and scan for actual `ghp_` or `github_pat_` credential values. Existing ignored delivery, dependency and installer artifacts are not deleted.

- [ ] **Step 6: Request independent code review and close findings**

Review the range from the design commit through implementation. Required focus: generic-write bypass, weight/progress arithmetic, identity before state/version leakage, submitter/reviewer separation, immutable delivery content, latest-version milestone logic, all close blockers, read-only extension facade, transaction rollback, seed consistency and fixed plugin contributions. Fix all Critical/Important findings and rerun affected red-green tests plus full gates.

- [ ] **Step 7: Commit and push**

```powershell
git add engine/domain-packs/README.md engine/domain-packs/packs/project_task/README.md
git commit -m "docs: document project task pack"
git push origin feature/next-update
```

Confirm `git rev-list --left-right --count origin/feature/next-update...HEAD` returns `0 0` and the worktree is clean.
