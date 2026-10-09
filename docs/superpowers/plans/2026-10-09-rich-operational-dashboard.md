# Rich Operational Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse, contradictory standard dashboard with permission-aware KPI, status, attention, and module-entry regions backed only by real locked domain summaries across all eight templates.

**Architecture:** Extend the existing `dashboard.sections` UI contribution into a validated numeric presentation contract. `DashboardService` keeps blueprint KPI queries, executes permitted summary actions in the main process through `DomainCommandService`, and returns one normalized snapshot; the renderer consumes only frozen display DTOs and uses existing module selection for navigation.

**Tech Stack:** TypeScript 7, Electron 44, React 19, SQLite `DatabaseSync`, Zod 4, Node test runner, Playwright, PowerShell acceptance tooling.

**Spec:** `docs/superpowers/specs/2026-10-09-rich-operational-dashboard-design.md`

## Global Constraints

- Apply the feature to all eight standard templates; leave `LegacyDemo` unchanged.
- Use only values from the locked blueprint, current SQLite database, and activated production domain packs.
- Do not add a time-series store, analytics dependency, generic renderer command execution, or dashboard mutations.
- Keep `business:dashboard:read` as the only renderer-facing dashboard channel.
- Omit only sections that the current server-resolved actor cannot read; any permitted summary failure must return an error, never a false empty state.
- Dashboard presentation descriptors and returned DTOs must be strict, deterministic, deeply immutable, and free of executable content.
- Preserve current entity schemas, migrations, workflows, and cross-table transaction behavior.
- Follow TDD for every task and commit after each independently passing task.

---

## File Structure

**Create:**

- `engine/desktop-runtime/src/core/dashboard-contributions.ts` — strict contribution parsing and summary normalization.
- `engine/desktop-runtime/tests/unit/dashboard-contributions.test.ts` — descriptor and normalization boundary tests.
- `engine/desktop-runtime/src/renderer/dashboard-model.ts` — pure renderer view-model derivation for status, attention, and empty states.
- `engine/desktop-runtime/tests/unit/dashboard-model.test.ts` — renderer behavior tests without DOM mocks.
- `engine/desktop-runtime/tests/integration/dashboard-sections.test.ts` — real plugin/database snapshot tests.
- `engine/domain-packs/tests/unit/production-dashboard-ui.test.ts` — strict dashboard presentation coverage for all five packs.

**Modify:**

- `engine/desktop-runtime/src/shared/dto.ts` — normalized dashboard DTO contract.
- `engine/desktop-runtime/src/core/dashboard-service.ts` — combine KPI queries with permitted domain summaries.
- `engine/desktop-runtime/src/main/index.ts` — construct domain service before dashboard service and inject activated contributions.
- `engine/desktop-runtime/src/main/ipc-handlers.ts` — retain the strict actor-resolved dashboard request boundary.
- `engine/desktop-runtime/src/preload/api.ts` — type the normalized snapshot without widening renderer input.
- `engine/desktop-runtime/src/renderer/App.tsx` — explicit loading/ready/error state and refresh flow.
- `engine/desktop-runtime/src/renderer/components/Dashboard.tsx` — operational dashboard rendering and module navigation.
- `engine/desktop-runtime/src/renderer/styles.css` — dense responsive dashboard layout.
- `engine/domain-packs/packs/application_archive/ui/index.ts` — application status and attention mapping.
- `engine/domain-packs/packs/inspection_rectification/ui/index.ts` — inspection status and attention mapping.
- `engine/domain-packs/packs/work_order_service/ui/index.ts` — work-order status and SLA attention mapping.
- `engine/domain-packs/packs/inventory_batch/ui/index.ts` — inventory scale and expiry attention mapping.
- `engine/domain-packs/packs/project_task/ui/index.ts` — project lifecycle and workflow attention mapping.
- `engine/desktop-runtime/tests/unit/ipc-contract.test.ts` — preserve the token-only preload call.
- `engine/desktop-runtime/tests/integration/ipc-handlers.test.ts` — preserve server-side actor resolution.
- `engine/desktop-runtime/tests/unit/material-descriptors.test.ts` — preserve all eight executable template combinations.
- `engine/desktop-runtime/tests/e2e/standard-template-smoke.spec.ts` — packaged dashboard loading and refresh checks.
- `engine/desktop-runtime/tests/e2e/project-actions-acceptance.spec.ts` — project attention values must match workflow state.
- `engine/desktop-runtime/tools/capture-standard-screenshots.cjs` — wait for a ready dashboard before capture.
- `engine/tests/StandardBusinessAcceptance.Tests.ps1` — verify representative packaged dashboard evidence.

---

### Task 1: Define And Validate The Dashboard Contribution Contract

**Files:**

- Create: `engine/desktop-runtime/src/core/dashboard-contributions.ts`
- Create: `engine/desktop-runtime/tests/unit/dashboard-contributions.test.ts`
- Modify: `engine/desktop-runtime/src/shared/dto.ts`

**Interfaces:**

- Produces `DashboardSnapshotDto`, `DashboardSectionDto`, `DashboardGroupDto`, `DashboardItemDto`, and `DashboardMetricDto` from `shared/dto.ts`.
- Produces `parseDashboardContributions(uiExtensions, domainActions, blueprint)` and `normalizeDashboardSection(definition, raw)` from `core/dashboard-contributions.ts`.
- Later tasks consume the parsed definitions and normalized section DTOs without reading raw plugin objects.

- [ ] **Step 1: Write failing strict-contract tests**

Create table-driven tests that use literal descriptors and expected issue codes. Cover one valid section and these invalid mutations: unknown property, duplicate group ID, duplicate item ID, unknown data source, action identity mismatch, parser rejecting `{}`, missing module, missing summary key, negative number, `NaN`, and string value.

```ts
test('normalizes one strict project dashboard contribution', () => {
  const definitions = parseDashboardContributions(uiExtensions, domainActions, blueprint);
  assert.deepEqual(normalizeDashboardSection(definitions[0]!, {
    planning: 3, active: 2, pendingTaskReviews: 4
  }), {
    id: 'project_dashboard', label: '项目概览', order: 20,
    groups: [
      { id: 'project_status', label: '项目状态', kind: 'status', items: [
        { id: 'planning', label: '规划中', value: 3, tone: 'neutral', moduleId: 'projects' },
        { id: 'active', label: '进行中', value: 2, tone: 'teal', moduleId: 'projects' }
      ]},
      { id: 'project_attention', label: '需要关注', kind: 'attention', items: [
        { id: 'pending_task_reviews', label: '待验收任务', value: 4, tone: 'amber', moduleId: 'project_tasks' }
      ]}
    ]
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/unit/dashboard-contributions.test.ts
```

Expected: FAIL because the DTOs and parser module do not exist.

- [ ] **Step 3: Add the DTOs and minimal strict parser**

Use exact DTO shapes:

```ts
export interface DashboardItemDto {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly tone: 'neutral' | 'teal' | 'amber' | 'red';
  readonly moduleId?: string;
}
export interface DashboardGroupDto {
  readonly id: string;
  readonly label: string;
  readonly kind: 'status' | 'attention';
  readonly items: readonly DashboardItemDto[];
}
export interface DashboardSectionDto {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly groups: readonly DashboardGroupDto[];
}
export interface DashboardMetricDto {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly tone: 'neutral' | 'teal' | 'amber' | 'red';
}
export interface DashboardSnapshotDto {
  readonly metrics: readonly DashboardMetricDto[];
  readonly sections: readonly DashboardSectionDto[];
}
```

The parser must accept only `slot === 'dashboard.sections'`, validate one to three groups and one to twelve items per group, verify `sourceKey` with `/^[a-z][A-Za-z0-9]{1,63}$/`, call the backing action parser with a frozen empty object, verify declared modules against `blueprint.modules`, sort sections by `order` then `id`, and deep-freeze outputs.

- [ ] **Step 4: Run unit tests and typecheck GREEN**

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/unit/dashboard-contributions.test.ts
npm.cmd run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the contract**

```powershell
git add engine/desktop-runtime/src/shared/dto.ts engine/desktop-runtime/src/core/dashboard-contributions.ts engine/desktop-runtime/tests/unit/dashboard-contributions.test.ts
git commit -m "feat: define dashboard section contract"
```

---

### Task 2: Declare Presentation Mappings In Five Production Packs

**Files:**

- Modify: the five `engine/domain-packs/packs/*/ui/index.ts` files listed in File Structure.
- Create: `engine/domain-packs/tests/unit/production-dashboard-ui.test.ts`

**Interfaces:**

- Consumes the contribution shape from Task 1.
- Produces five immutable `dashboard.sections` descriptors whose `sourceKey` values match existing summary result properties exactly.

- [ ] **Step 1: Add failing descriptor coverage tests**

Assert these literal mappings:

```ts
const expected = {
  application_archive: {
    status: ['draft','approving','approved','archived'],
    attention: ['pendingMyApprovals','upcomingCertificates','expiredCertificates','pendingReminders','stagedFiles','failedFiles']
  },
  inspection_rectification: {
    status: ['pending','executing','pendingReview','archived'],
    attention: ['pendingReview','abnormalItems']
  },
  work_order_service: {
    status: ['total','closed'],
    attention: ['pendingReview','overdue']
  },
  inventory_batch: {
    status: ['materials','warehouses','batches','totalQuantity','transactions'],
    attention: ['warningBatches','expiredBatches']
  },
  project_task: {
    status: ['planning','active','pendingClose','closed'],
    attention: ['overdueProjects','overdueMilestones','pendingTaskReviews','openHighRisks','submittedDeliverables']
  }
};
```

Also assert every attention item has a valid target module and every red item represents an overdue, expired, failed, abnormal, or high-risk value.

- [ ] **Step 2: Run domain-pack unit test RED**

```powershell
cd engine/domain-packs
node --import tsx --test tests/unit/production-dashboard-ui.test.ts
```

Expected: FAIL because `presentation.groups` is absent.

- [ ] **Step 3: Add exact immutable mappings**

Use controlled labels and module targets. Examples:

```ts
presentation: Object.freeze({ groups: Object.freeze([
  Object.freeze({ id:'project_status', label:'项目状态', kind:'status', items:Object.freeze([
    Object.freeze({ id:'planning', sourceKey:'planning', label:'规划中', tone:'neutral', moduleId:'projects' }),
    Object.freeze({ id:'active', sourceKey:'active', label:'进行中', tone:'teal', moduleId:'projects' }),
    Object.freeze({ id:'pending_close', sourceKey:'pendingClose', label:'待关闭复核', tone:'amber', moduleId:'projects' }),
    Object.freeze({ id:'closed', sourceKey:'closed', label:'已关闭', tone:'neutral', moduleId:'projects' })
  ])}),
  Object.freeze({ id:'project_attention', label:'需要关注', kind:'attention', items:Object.freeze([
    Object.freeze({ id:'overdue_projects', sourceKey:'overdueProjects', label:'逾期项目', tone:'red', moduleId:'projects' }),
    Object.freeze({ id:'overdue_milestones', sourceKey:'overdueMilestones', label:'逾期里程碑', tone:'red', moduleId:'milestones' }),
    Object.freeze({ id:'pending_task_reviews', sourceKey:'pendingTaskReviews', label:'待验收任务', tone:'amber', moduleId:'project_tasks' }),
    Object.freeze({ id:'open_high_risks', sourceKey:'openHighRisks', label:'开放高风险', tone:'red', moduleId:'project_risks' }),
    Object.freeze({ id:'submitted_deliverables', sourceKey:'submittedDeliverables', label:'待验收交付物', tone:'amber', moduleId:'deliverables' })
  ])})
])})
```

Apply equivalent literal mappings for application, inspection, work-order, and inventory summaries.

- [ ] **Step 4: Rebuild generated catalogs and run pack tests GREEN**

```powershell
cd engine/domain-packs
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:combinations
npm.cmd run build
npm.cmd run build:runtime-catalog
```

Expected: all commands exit 0 and the ignored runtime catalog build contains the new descriptors.

- [ ] **Step 5: Commit pack mappings**

```powershell
git add engine/domain-packs/packs/application_archive/ui/index.ts engine/domain-packs/packs/inspection_rectification/ui/index.ts engine/domain-packs/packs/work_order_service/ui/index.ts engine/domain-packs/packs/inventory_batch/ui/index.ts engine/domain-packs/packs/project_task/ui/index.ts engine/domain-packs/tests/unit/production-dashboard-ui.test.ts
git commit -m "feat: declare operational dashboard sections"
```

---

### Task 3: Aggregate Permission-Aware Dashboard Snapshots

**Files:**

- Create: `engine/desktop-runtime/tests/integration/dashboard-sections.test.ts`
- Modify: `engine/desktop-runtime/src/core/dashboard-service.ts`
- Modify: `engine/desktop-runtime/src/main/index.ts`

**Interfaces:**

- Consumes Task 1 parser/normalizer and Task 2 contributions.
- Changes `DashboardService.read(actor)` return type from `readonly DashboardMetricDto[]` to `DashboardSnapshotDto`.
- Constructor receives `plugins: ActivatedPluginHost`, `permissions: PermissionService`, and `domain: Pick<DomainCommandService,'execute'>` in addition to the existing database, blueprint, and schema.

- [ ] **Step 1: Write failing real-runtime integration tests**

Build a project template with real SQLite and activated production plugins. Assert:

```ts
const snapshot = dashboard.read(manager);
assert.deepEqual(snapshot.sections[0]?.groups.find(g => g.kind === 'attention')?.items.map(i => [i.id,i.value]), [
  ['overdue_projects', 1],
  ['overdue_milestones', 1],
  ['pending_task_reviews', 1],
  ['open_high_risks', 1],
  ['submitted_deliverables', 1]
]);
assert.equal(Object.isFrozen(snapshot.sections[0]?.groups[0]?.items), true);
```

Add separate cases proving unauthorized sections are omitted, a permitted action exception rejects the whole read, and two contributions in a composite template are sorted deterministically and each execute once.

- [ ] **Step 2: Run integration test RED**

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/integration/dashboard-sections.test.ts
```

Expected: FAIL because `DashboardService` returns only metrics and has no contribution dependencies.

- [ ] **Step 3: Implement snapshot aggregation**

Preserve existing SQL metric evaluation in a private `readMetrics()` method. Parse contributions once in the constructor. During `read(actor)`, obtain the backing action permission from `plugins.domainActions`, omit when `permissions.allows(actor, permission)` is false, otherwise call `domain.execute(definition.dataSource, Object.freeze({}), actor)` exactly once and normalize the result.

```ts
read(actor: ActorDto): DashboardSnapshotDto {
  const metrics = this.readMetrics();
  const sections = this.definitions.flatMap((definition) => {
    const action = this.plugins.domainActions[definition.dataSource]!.value as { permission: string };
    if (!this.permissions.allows(actor, action.permission)) return [];
    const raw = this.domain.execute(definition.dataSource, Object.freeze({}), actor);
    return [normalizeDashboardSection(definition, raw)];
  });
  return Object.freeze({ metrics: Object.freeze(metrics), sections: Object.freeze(sections) });
}
```

Construct `DomainCommandService` before `DashboardService` in `main/index.ts` and inject the same locked plugin host and permission service.

- [ ] **Step 4: Run dashboard, domain, and integration suites GREEN**

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/integration/dashboard-sections.test.ts tests/unit/domain-action-metadata.test.ts
npm.cmd run typecheck
npm.cmd run test:integration
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit runtime aggregation**

```powershell
git add engine/desktop-runtime/src/core/dashboard-service.ts engine/desktop-runtime/src/main/index.ts engine/desktop-runtime/tests/integration/dashboard-sections.test.ts
git commit -m "feat: aggregate permission-aware dashboards"
```

---

### Task 4: Build A Pure Dashboard View Model And Explicit Load State

**Files:**

- Create: `engine/desktop-runtime/src/renderer/dashboard-model.ts`
- Create: `engine/desktop-runtime/tests/unit/dashboard-model.test.ts`
- Modify: `engine/desktop-runtime/src/renderer/App.tsx`

**Interfaces:**

- Consumes `DashboardSnapshotDto`.
- Produces `buildDashboardModel(snapshot)` with sorted `statusGroups`, nonzero severity-sorted `attentionItems`, and `attentionEmpty`.
- `App` passes `{ state, modules, onRefresh, onNavigate }` to `Dashboard`.

- [ ] **Step 1: Write failing pure model tests**

Use literal snapshots to prove zero attention items are removed, red precedes amber then neutral, descriptor order is stable within a tone, status bar denominators never divide by zero, and `attentionEmpty` is true only when every accessible attention value is zero.

```ts
const model = buildDashboardModel(snapshot);
assert.deepEqual(model.attentionItems.map((item) => item.id), ['overdue_projects','pending_task_reviews']);
assert.equal(model.attentionEmpty, false);
assert.deepEqual(model.statusGroups[0]?.items.map((item) => item.ratio), [1, 0.5, 0, 0]);
```

- [ ] **Step 2: Run model test RED**

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/unit/dashboard-model.test.ts
```

Expected: FAIL because the pure model module does not exist.

- [ ] **Step 3: Implement the pure model and App state machine**

Use a discriminated union:

```ts
type DashboardState =
  | Readonly<{ status:'loading' }>
  | Readonly<{ status:'ready'; snapshot:DashboardSnapshotDto }>
  | Readonly<{ status:'error' }>;
```

Implement one `loadDashboard` callback used by navigation-to-dashboard and refresh. Set `loading` before each read, `ready` only after `unwrap`, and `error` on rejection. Logout resets to `loading`. Do not convert failures to an empty snapshot.

- [ ] **Step 4: Run model, unit, and type tests GREEN**

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/unit/dashboard-model.test.ts
npm.cmd run typecheck
npm.cmd run test:unit
```

Expected: all commands exit 0.

- [ ] **Step 5: Lock the unchanged IPC request boundary and commit renderer state model**

Add assertions to `tests/unit/ipc-contract.test.ts` and `tests/integration/ipc-handlers.test.ts` that dashboard reads still send exactly `{ token }`, resolve the actor only from the session, and reject extra `commandId`, `dataSource`, or `sectionId` properties. Update dashboard response fixtures from an array to `{ metrics, sections }`; do not add a channel or renderer-selected data source.

Run:

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/unit/ipc-contract.test.ts tests/integration/ipc-handlers.test.ts tests/unit/dashboard-model.test.ts
```

Expected: all tests exit 0.

```powershell
git add engine/desktop-runtime/src/renderer/dashboard-model.ts engine/desktop-runtime/src/renderer/App.tsx engine/desktop-runtime/src/preload/api.ts engine/desktop-runtime/src/main/ipc-handlers.ts engine/desktop-runtime/tests/unit/dashboard-model.test.ts engine/desktop-runtime/tests/unit/ipc-contract.test.ts engine/desktop-runtime/tests/integration/ipc-handlers.test.ts
git commit -m "feat: model dashboard loading and attention"
```

---

### Task 5: Render The Operational Dashboard

**Files:**

- Modify: `engine/desktop-runtime/src/renderer/components/Dashboard.tsx`
- Modify: `engine/desktop-runtime/src/renderer/styles.css`
- Modify: `engine/desktop-runtime/tests/e2e/ui-contract.spec.ts`

**Interfaces:**

- Consumes Task 4 `DashboardState`, runtime modules, refresh callback, and module navigation callback.
- Produces accessible controls named `刷新仪表盘`, `查看<module name>`, and stable regions `核心指标`, `状态概览`, `待办工作`, `业务入口`.

- [ ] **Step 1: Add failing UI contract scenarios**

Cover desktop and 1100x760 minimum viewport. Assert nonzero attention rows are visible, the false empty message is absent, zero-only input shows the empty state, retry calls refresh, a module entry calls navigation, and the longest provided Chinese labels do not overflow their regions.

```ts
await expect(page.getByRole('region', { name:'待办工作' }).getByText('待验收任务')).toBeVisible();
await expect(page.getByText('没有需要立即处理的业务事项。')).toHaveCount(0);
await page.getByRole('button', { name:'查看项目任务' }).click();
await expect(page.getByRole('heading', { name:'项目任务' })).toBeVisible();
```

- [ ] **Step 2: Run Playwright UI contract RED**

```powershell
cd engine/desktop-runtime
npx.cmd playwright test tests/e2e/ui-contract.spec.ts
```

Expected: FAIL because the regions and controls do not exist and the old empty text is hard-coded.

- [ ] **Step 3: Implement component and restrained responsive CSS**

Use Lucide `RefreshCw`, `ArrowRight`, and `AlertTriangle` icons. Keep KPI cards at `border-radius: 7px`. Render status and attention as unframed full-width regions separated by borders, not cards inside cards. Use fixed-height status tracks and stable grid columns:

```css
.dashboard-main-grid { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr); gap:18px; }
.status-track { height:8px; border-radius:4px; background:#e4e9ed; overflow:hidden; }
.status-fill { height:100%; background:#24877d; }
.attention-row { min-height:48px; display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; }
@media (max-width: 980px) { .dashboard-main-grid { grid-template-columns:1fr; } }
```

The refresh button has an icon and tooltip/accessible label. Attention rows with `moduleId` use an arrow icon button. Business entries use compact icon-plus-text buttons and the same modules already supplied to `AppShell`.

- [ ] **Step 4: Run UI, unit, type, and build checks GREEN**

```powershell
cd engine/desktop-runtime
npx.cmd playwright test tests/e2e/ui-contract.spec.ts
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run build
```

Expected: all commands exit 0 at desktop and minimum viewport.

- [ ] **Step 5: Commit dashboard UI**

```powershell
git add engine/desktop-runtime/src/renderer/components/Dashboard.tsx engine/desktop-runtime/src/renderer/styles.css engine/desktop-runtime/tests/e2e/ui-contract.spec.ts
git commit -m "feat: render operational dashboard workspace"
```

---

### Task 6: Verify All Templates And Packaged Evidence

**Files:**

- Modify: `engine/desktop-runtime/tests/unit/material-descriptors.test.ts`
- Modify: `engine/desktop-runtime/tests/e2e/standard-template-smoke.spec.ts`
- Modify: `engine/desktop-runtime/tests/e2e/project-actions-acceptance.spec.ts`
- Modify: `engine/desktop-runtime/tools/capture-standard-screenshots.cjs`
- Modify: `engine/tests/StandardBusinessAcceptance.Tests.ps1`

**Interfaces:**

- Consumes the final snapshot/UI contracts from Tasks 1–5.
- Produces screenshot and packaged acceptance evidence proving that generated applications show truthful dashboards.

- [ ] **Step 1: Add failing eight-template and packaged assertions**

For every standard template, build locked resources and assert an administrator receives at least one dashboard section. For project packaged acceptance, assert the visible attention values match domain summary output after the workflow creates pending/closed state. Update screenshot capture to wait for the `核心指标` region and at least one `dashboard-section` before taking `02-dashboard.png`.

```ts
await expect(page.getByRole('region', { name:'核心指标' })).toBeVisible();
await expect(page.getByRole('region', { name:'待办工作' }).getByText('待验收任务')).toContainText('2');
await expect(page.getByText('没有需要立即处理的业务事项。')).toHaveCount(0);
```

- [ ] **Step 2: Run focused acceptance RED**

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/unit/material-descriptors.test.ts
npx.cmd playwright test tests/e2e/standard-template-smoke.spec.ts tests/e2e/project-actions-acceptance.spec.ts
```

Expected: FAIL until packaged dashboard assertions and capture readiness use the new regions.

- [ ] **Step 3: Complete capture and acceptance integration**

Wait on semantic regions rather than arbitrary sleep. Preserve the existing screenshot count, hash binding, nonblank checks, and workflow metadata. Do not add a second dashboard screenshot merely to inflate evidence.

- [ ] **Step 4: Run the full verification matrix**

```powershell
.\verify-dev.bat
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-All.ps1 -IncludeE2E
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-All.ps1 -IncludeStandardBusinessAcceptance
```

Expected: every command exits 0, eight template combinations pass, representative packaged dashboards are nonblank and actionable, and the project dashboard never reports an empty task state while pending counts are nonzero.

- [ ] **Step 5: Inspect representative screenshots**

Open the generated `02-dashboard.png` files for inspection, inventory, and project representatives. Verify at 1440x960 and minimum-width capture that no labels overlap, KPI dimensions are stable, attention rows are visible, and the next content region is present without excessive first-viewport whitespace.

- [ ] **Step 6: Commit acceptance updates**

```powershell
git add engine/desktop-runtime/tests engine/desktop-runtime/tools/capture-standard-screenshots.cjs engine/tests/StandardBusinessAcceptance.Tests.ps1
git commit -m "test: verify rich packaged dashboards"
```

- [ ] **Step 7: Final branch check**

```powershell
git diff --check
git status --short
git log --oneline -8
```

Expected: no whitespace errors and no uncommitted generated artifacts.
