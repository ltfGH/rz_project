# Project Actions and Screenshot Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project templates fully operable from the Electron UI and let standard generation capture a verified project action when the blueprint has no generic workflows.

**Architecture:** A pure renderer action-form registry owns labels, scopes, typed fields, and request construction for fixed project domain commands. `DomainActions` renders module-level and record-level definitions without duplicating domain authorization. Screenshot planning prefers generic workflows, then falls back to a fixed project domain-action mapping whose UI control is verified in the packaged app.

**Tech Stack:** TypeScript 7, React 19, Electron 44, Playwright 1.63, Windows PowerShell 5.1, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-09-28-project-actions-and-screenshot-fallback-design.md`

## Global Constraints

- Work directly on `feature/next-update`; the user explicitly declined worktrees.
- Do not change schemas, migrations, domain command IDs, permissions, state rules, or transaction boundaries.
- Do not expose a generic IPC channel or accept renderer-provided actor identity.
- Existing asset, inspection, work-order, legacy generator, and eight-template resource tests remain green.
- An action screenshot is valid only when its exact fixed control is visible and its executable, blueprint, and image hashes match.

---

### Task 1: Scoped Project Action Metadata

**Files:**
- Modify: `engine/domain-packs/packs/project_task/ui/index.ts`
- Modify: `engine/domain-packs/tests/integration/project-pack.test.ts`
- Modify: `engine/desktop-runtime/src/shared/dto.ts`
- Modify: `engine/desktop-runtime/src/main/index.ts`
- Modify: `engine/desktop-runtime/tests/integration/ipc-handlers.test.ts`

**Interfaces:**
- `DomainActionDto` gains `scope: 'module' | 'record'`.
- Project UI extensions use fixed slots `entity.module.actions` and `entity.detail.actions`.
- Metadata exposes only actions whose fixed permission is granted to the authenticated actor.

- [ ] **Step 1: Write failing project UI descriptor tests**

Assert exact scoped contributions:

```ts
assert.deepEqual(extension('project.module.actions'), {
  id:'project.module.actions', slot:'entity.module.actions', entityId:'project',
  label:'项目操作', order:10, actionIds:['project.create']
});
assert.deepEqual(extension('project.lifecycle.actions').actionIds, [
  'project.update','project.activate','project.request_close','project.reject_close',
  'project.approve_close','project.milestone.create','project.task.create',
  'project.risk.create','project.deliverable.submit'
]);
assert.deepEqual(extension('project.milestone.actions').actionIds, ['project.milestone.complete']);
assert.equal(extension('project.task.actions').actionIds.includes('project.task.update'), true);
```

- [ ] **Step 2: Write failing metadata scope and permission tests**

Exercise metadata through the existing service fixture. Assert dispatcher receives module-scoped `project.create`, operator does not, and every returned action contains exactly `id`, `entityId`, `label`, `order`, and `scope`.

- [ ] **Step 3: Run focused tests and verify failures**

Run:

```powershell
cd engine/domain-packs
node --import tsx --test tests/integration/project-pack.test.ts
cd ../desktop-runtime
node --import tsx --test tests/integration/ipc-handlers.test.ts
```

Expected: FAIL because module actions and `scope` are absent.

- [ ] **Step 4: Add fixed scoped extensions and metadata mapping**

Add `entity.module.actions` to the project UI descriptor slots. In the main metadata projection, accept only the two exact slots and translate them to `scope='module'` or `scope='record'`. Continue resolving action permission through `plugins.domainActions` and `permissions.allows` before emitting the DTO.

- [ ] **Step 5: Run focused and domain pack tests**

Run:

```powershell
cd engine/domain-packs
npm run typecheck
npm test
cd ../desktop-runtime
npm run typecheck
node --import tsx --test tests/integration/ipc-handlers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add engine/domain-packs/packs/project_task/ui/index.ts engine/domain-packs/tests/integration/project-pack.test.ts engine/desktop-runtime/src/shared/dto.ts engine/desktop-runtime/src/main/index.ts engine/desktop-runtime/tests/integration/ipc-handlers.test.ts
git commit -m "feat: expose scoped project actions in metadata"
```

---

### Task 2: Pure Project Action Form Registry

**Files:**
- Create: `engine/desktop-runtime/src/renderer/domain/project-action-forms.ts`
- Create: `engine/desktop-runtime/tests/unit/project-action-forms.test.ts`

**Interfaces:**
- Produces `ActionFormDefinition`, `ActionFieldDefinition`, and `ActionScope`.
- Produces `getProjectActionForm(actionId: string): ActionFormDefinition | undefined`.
- Produces `buildProjectActionInput(definition, values, record?): Readonly<Record<string, unknown>>`.
- Produces `getProjectActionInitialValues(definition, record?): Readonly<Record<string, string | boolean>>` for update forms.
- A definition has `id`, `label`, `entityId`, `scope`, `fields`, and a fixed input builder.

- [ ] **Step 1: Write failing registry coverage tests**

Assert that the registry contains exactly the supported mutating project actions, excludes `project.summary` and `project.dashboard_summary`, and declares only `project.create` as module-scoped:

```ts
const create = getProjectActionForm('project.create');
assert.equal(create?.scope, 'module');
assert.equal(create?.entityId, 'project');
assert.equal(getProjectActionForm('project.summary'), undefined);
assert.equal(getProjectActionForm('project.dashboard_summary'), undefined);
assert.deepEqual(projectActionFormIds, [
  'project.create','project.update','project.activate','project.request_close',
  'project.reject_close','project.approve_close','project.milestone.create',
  'project.milestone.complete','project.task.create','project.task.update',
  'project.task.start','project.task.progress','project.task.submit',
  'project.task.reject','project.task.approve','project.task.cancel',
  'project.task.restore','project.risk.create','project.risk.mitigate',
  'project.risk.close','project.risk.reopen','project.deliverable.submit',
  'project.deliverable.review'
]);
```

- [ ] **Step 2: Run the focused test and verify module-not-found failure**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/project-action-forms.test.ts`

Expected: FAIL because `project-action-forms.ts` does not exist.

- [ ] **Step 3: Test typed request construction**

Cover module creation, selected-project child creation, versioned record actions, number, boolean, date, nullable milestone code, and select fields:

```ts
assert.deepEqual(buildProjectActionInput(create!, {
  name:'Edge Distribution', managerId:'dispatcher',
  plannedStartAt:'2026-10-01', plannedEndAt:'2026-12-31'
}), {
  name:'Edge Distribution', managerId:'dispatcher',
  plannedStartAt:'2026-10-01', plannedEndAt:'2026-12-31'
});

assert.deepEqual(buildProjectActionInput(getProjectActionForm('project.task.create')!, {
  milestoneCode:'', title:'Distribute package', description:'Send package to edge nodes',
  assigneeId:'operator', weight:'25', required:'true'
}, { id:17, version:4, values:{} }), {
  projectId:17, milestoneCode:null, title:'Distribute package',
  description:'Send package to edge nodes', assigneeId:'operator', weight:25, required:true
});
```

Assert missing record, invalid number/boolean/date, and unknown values fail before IPC without echoing field values.

Assert project and pending-task update forms prefill editable values from the selected record while create forms use only fixed safe defaults.

- [ ] **Step 4: Implement immutable fixed definitions and request builders**

Use the exact request fields from `packs/project_task/runtime/types.ts`. Fixed base mappings are:

```ts
project record     -> { projectId: record.id, expectedVersion: record.version }
milestone record   -> { milestoneId: record.id, expectedVersion: record.version }
project_task record-> { taskId: record.id, expectedVersion: record.version }
project_risk record-> { riskId: record.id, expectedVersion: record.version }
deliverable record -> { deliverableId: record.id, expectedVersion: record.version }
selected project child creation -> { projectId: record.id }
```

Define labels in Chinese and field metadata for every action. Freeze exported definitions and returned request objects.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/unit/project-action-forms.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add engine/desktop-runtime/src/renderer/domain/project-action-forms.ts engine/desktop-runtime/tests/unit/project-action-forms.test.ts
git commit -m "feat: define project action forms"
```

---

### Task 3: Render Module-Level and Record-Level Project Actions

**Files:**
- Modify: `engine/desktop-runtime/src/renderer/components/DomainActions.tsx`
- Modify: `engine/desktop-runtime/src/renderer/screens/ModuleScreen.tsx`
- Create: `engine/desktop-runtime/tests/unit/domain-action-presentation.test.ts`

**Interfaces:**
- `DomainActions` accepts `record?: EntityRecordDto` and `scope: 'module' | 'record'`.
- `DomainActions` uses the project registry first, then preserves existing asset/inspection/work-order definitions.
- `onComplete` remains the single reload callback and receives no untrusted result data.

- [ ] **Step 1: Write failing presentation selection tests**

Extract and test pure exported helpers from `DomainActions.tsx` or a sibling `action-presentation.ts` if importing TSX introduces DOM dependencies:

```ts
assert.deepEqual(
  selectPresentableActions(actions, 'project', 'module', undefined).map(x=>x.id),
  ['project.create']
);
assert.deepEqual(
  selectPresentableActions(actions, 'project', 'record', record).map(x=>x.id),
  ['project.update','project.activate','project.request_close']
);
```

Assert module scope never includes record actions, record scope never includes `project.create`, and legacy asset actions remain presentable.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/domain-action-presentation.test.ts`

Expected: FAIL because scope-aware selection is absent.

- [ ] **Step 3: Refactor `DomainActions` around fixed definitions**

Render `date` as `<input type="date">`, `boolean` as a checkbox, numeric fields as number inputs, and selects from fixed options. Use `buildProjectActionInput` for project commands and retain current legacy builders for existing commands. A command with no input fields executes only after an explicit confirmation button; clicking its action first opens a confirmation form rather than mutating immediately.

- [ ] **Step 4: Add module-level actions to `ModuleScreen`**

Render:

```tsx
<DomainActions
  token={token}
  entityId={module.entity}
  scope="module"
  actions={domainActions}
  onComplete={() => void load()}
/>
```

near the section heading. Pass `scope="record"` and `record={selected}` in the detail drawer. After record completion, reload the selected record and page; after module completion, reload the page.

- [ ] **Step 5: Run focused and complete desktop tests**

Run:

```powershell
cd engine/desktop-runtime
node --import tsx --test tests/unit/project-action-forms.test.ts tests/unit/domain-action-presentation.test.ts
npm run typecheck
npm run test:unit
npm run test:integration
```

Expected: PASS; existing action behavior remains unchanged.

- [ ] **Step 6: Commit**

```powershell
git add engine/desktop-runtime/src/renderer/components/DomainActions.tsx engine/desktop-runtime/src/renderer/screens/ModuleScreen.tsx engine/desktop-runtime/src/renderer/domain engine/desktop-runtime/tests/unit
git commit -m "feat: expose project domain actions in desktop UI"
```

---

### Task 4: Domain-Action Screenshot Fallback

**Files:**
- Modify: `engine/lib/StandardBusinessMaterials.psm1`
- Modify: `engine/tests/StandardBusinessMaterials.Tests.ps1`
- Modify: `engine/desktop-runtime/tools/capture-standard-screenshots.cjs`

**Interfaces:**
- `Get-StandardScreenshotPlan` continues to return five captures.
- Workflow action entries retain `actionType='workflow'` and `actionScope='record'`.
- No-workflow project entries use `actionType='domain'`, `actionScope='module'`, `actionId='project.create'`, and label `创建项目`.

- [ ] **Step 1: Write a failing no-workflow plan test**

Add a project blueprint fixture with `workflows=@()` and project module action `create_project`. Assert:

```powershell
$action = @(Get-StandardScreenshotPlan -Blueprint $projectBlueprint | Where-Object kind -eq 'action')[0]
Assert-Equal $action.moduleId 'projects'
Assert-Equal $action.actionId 'project.create'
Assert-Equal $action.actionLabel '创建项目'
Assert-Equal $action.actionType 'domain'
Assert-Equal $action.actionScope 'module'
Assert-Equal $action.roleId 'operations_dispatcher'
```

- [ ] **Step 2: Run the focused test and verify current workflow error**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessMaterials.Tests.ps1`

Expected: FAIL with `Blueprint has no workflow transition for an action screenshot.`

- [ ] **Step 3: Implement fixed domain fallback selection**

Use a strict map containing only:

```powershell
'projects.create_project' = @{
  DomainActionId='project.create'; Label='创建项目'; Scope='module'
}
```

Select the first matching module action with a composite role that owns `projects.create_project`. Do not infer arbitrary command names from strings. Keep workflow selection as the first choice.

- [ ] **Step 4: Teach packaged capture about action scope**

For `actionScope='module'`, navigate to the aliased module and verify the exact action button without opening a row. For record scope, retain the bounded row search. Write `actionType`, `actionScope`, `actionLabel`, and `controlVerified` into the manifest.

- [ ] **Step 5: Run focused tests and syntax checks**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessMaterials.Tests.ps1
node --check engine/desktop-runtime/tools/capture-standard-screenshots.cjs
```

Expected: PASS for workflow and project-domain plans.

- [ ] **Step 6: Commit**

```powershell
git add engine/lib/StandardBusinessMaterials.psm1 engine/tests/StandardBusinessMaterials.Tests.ps1 engine/desktop-runtime/tools/capture-standard-screenshots.cjs
git commit -m "fix: capture project domain actions without workflows"
```

---

### Task 5: Packaged Project UI Acceptance and Generator Regression

**Files:**
- Create: `engine/desktop-runtime/tests/e2e/project-actions-acceptance.spec.ts`
- Create: `engine/desktop-runtime/tools/project-actions-e2e.source.js`
- Modify: `engine/lib/StandardBusinessOrchestrator.psm1`
- Modify: `engine/tests/StandardBusinessOrchestrator.Tests.ps1`
- Modify: `engine/tests/StandardBusinessAcceptance.Tests.ps1`

**Interfaces:**
- `project_task_management` packaged verification runs generic smoke plus `project-actions-acceptance.spec.ts`.
- `project_delivery_archive` keeps its archive acceptance and also runs project UI acceptance when the selected module set contains project actions.

- [ ] **Step 1: Write the packaged UI acceptance**

The Playwright flow must:

1. log in as `dispatcher`;
2. resolve the themed `projects` module name from metadata;
3. open that module and click `创建项目` without selecting a row;
4. fill a unique project name, manager `dispatcher`, and valid start/end dates;
5. submit and verify exactly one persisted project through the named preload API;
6. open the created detail and verify `激活项目` is visible;
7. execute activation through the UI confirmation form;
8. verify status `active` after application restart.

The test uses isolated user data and contains no fixed release password.

- [ ] **Step 2: Run the focused E2E contract without environment**

Run: `cd engine/desktop-runtime; npx playwright test tests/e2e/project-actions-acceptance.spec.ts`

Expected: one skipped test because packaged environment variables are absent; TypeScript discovery succeeds.

- [ ] **Step 3: Wire template-specific verification**

Add `project_task_management -> tests/e2e/project-actions-acceptance.spec.ts` to the orchestrator specialized test mapping. For `project_delivery_archive`, run both project action UI and archive acceptance sequentially. Update orchestration tests to require both spec names.

- [ ] **Step 4: Make project task the representative full acceptance template**

Set `StandardBusinessAcceptance.Tests.ps1 -IncludeRepresentativeDelivery` to `project_task_management`. Keep DOCX/PDF/ZIP readability and five-image dimension assertions. Assert the screenshot manifest action entry is `project.create`, module-scoped, and `controlVerified=true`.

- [ ] **Step 5: Run the verification ladder**

Run:

```powershell
.\verify-dev.bat
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessAcceptance.Tests.ps1 -IncludeRepresentativeDelivery
git diff --check
```

Expected: all default checks pass; the packaged project UI flow, screenshot, materials, installer lifecycle, and fifteen-file delivery pass.

- [ ] **Step 6: Request focused code review and fix every Critical/Important finding**

Review the range from design commit `6093229` through the implementation head. Re-run the owning focused test after each fix.

- [ ] **Step 7: Commit final acceptance**

```powershell
git add engine/desktop-runtime/tests/e2e engine/desktop-runtime/tools engine/lib engine/tests
git commit -m "test: verify packaged project action workflow"
```

- [ ] **Step 8: Push and verify branch state**

Run:

```powershell
git push origin feature/next-update
git status --short
git log -6 --oneline --decorate
```

Expected: clean worktree and `origin/feature/next-update` at the implementation head.
