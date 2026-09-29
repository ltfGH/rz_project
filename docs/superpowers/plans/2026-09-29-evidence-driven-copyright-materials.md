# Evidence-Driven Copyright Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace placeholder standard documents with an eighteen-file, Demo-scale, evidence-driven software copyright material package for all eight supported templates.

**Architecture:** A strict `MaterialFacts` JSON boundary is assembled from locked resources, runtime action metadata, an introspected SQLite schema, receipts, screenshots, and the canonical source manifest. Deterministic HTML/diagram renderers and fixed Word templates consume only those facts; post-save Word/PDF inspection enforces page, text, table, media, source, and secret-exclusion contracts before atomic publication.

**Tech Stack:** Windows PowerShell 5.1, Node.js 22.21.0, TypeScript 7, Zod 4, Electron 44, React 19, SQLite, Playwright 1.63, Microsoft Word COM, System.Drawing, ZIP/OpenXML inspection.

**Spec:** `docs/superpowers/specs/2026-09-28-evidence-driven-copyright-materials-design.md`

## Global Constraints

- Work directly on `feature/next-update`; the user explicitly declined worktrees.
- Apply to all eight `StandardBusiness` templates; preserve `LegacyDemo` and its twelve-file contract.
- The standard contract is exactly eighteen flat files; the complete ZIP contains the other seventeen.
- Reuse `engine/template/materials/application-form-template.docx`; do not invent applicant identity, ownership, publication, completion date, organization date, classification, or abbreviation.
- Materials may describe only facts traceable to locked resources, compiled SQLite schema, fixed descriptors, screenshots, source manifest, or passed receipts.
- No plaintext passwords, tokens, local absolute paths, logs, databases, temporary files, raw internal action IDs, or unsupported claims in delivery output.
- Model-generated narrative is optional and schema-limited; deterministic rendering must remain complete when it is unavailable.
- Standard material failure removes material staging and stops publication; failed generation workspace remains for diagnosis.

---

### Task 1: Complete Application and Inventory UI Operations

**Files:**
- Modify: `engine/domain-packs/packs/application_archive/catalog.json`
- Modify: `engine/domain-packs/packs/application_archive/ui/index.ts`
- Modify: `engine/domain-packs/packs/inventory_batch/catalog.json`
- Modify: `engine/domain-packs/packs/inventory_batch/ui/index.ts`
- Modify: `engine/domain-packs/packs/inventory_application_bridge/ui/index.ts`
- Create: `engine/desktop-runtime/src/renderer/domain/application-action-forms.ts`
- Create: `engine/desktop-runtime/src/renderer/domain/inventory-action-forms.ts`
- Modify: `engine/desktop-runtime/src/renderer/domain/action-presentation.ts`
- Modify: `engine/desktop-runtime/src/renderer/components/DomainActions.tsx`
- Create: `engine/desktop-runtime/tests/unit/application-action-forms.test.ts`
- Create: `engine/desktop-runtime/tests/unit/inventory-action-forms.test.ts`
- Modify: `engine/domain-packs/tests/unit/application-ui.test.ts`
- Modify: `engine/domain-packs/tests/unit/inventory-ui.test.ts`

**Interfaces:**
- Produces fixed form registries with the same shape as `project-action-forms.ts`.
- Application module actions: `application.create`, `application.certificate.create`.
- Application record actions: update, submit, approve, reject, withdraw, revise, archive, certificate renew/refresh, reminder acknowledge, and bridge inventory application create where selected context is valid.
- Inventory module actions: material create, warehouse create, batch receive new.
- Inventory record actions: material/warehouse update, receive existing, issue, return, adjust.

- [x] **Step 1: Write failing exact-descriptor and request-builder tests**

Assert module/record scope, exact IDs, request field conversion, record ID/version injection, and exclusion of read-only summary/delete-guard actions. For example:

```ts
assert.equal(getApplicationActionForm('application.create')?.scope, 'module');
assert.deepEqual(buildInventoryActionInput(getInventoryActionForm('inventory.batch.issue')!, {
  quantity:'3', reason:'Approved use'
}, batch), { batchId:batch.id, expectedVersion:batch.version, quantity:3, reason:'Approved use' });
```

- [x] **Step 2: Run focused tests and verify missing-form failures**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/application-action-forms.test.ts tests/unit/inventory-action-forms.test.ts`

Expected: FAIL with module-not-found.

- [x] **Step 3: Add scoped UI contributions**

Add `entity.module.actions` to application/inventory catalogs. Module contributions expose only create/receive-new commands; record contributions contain the fixed mutation commands listed above. Existing main-process permission filtering remains authoritative.

- [x] **Step 4: Implement immutable action form registries and presentation selection**

Use exact request types from each pack's `runtime/types.ts`. Reject unknown fields and invalid number/date/boolean/select values with redacted errors. Extend `DomainActions` by registry lookup rather than adding another command switch.

- [x] **Step 5: Run focused, domain, desktop type, unit, and integration tests**

Run:

```powershell
npm --prefix engine/domain-packs run typecheck
npm --prefix engine/domain-packs test
npm --prefix engine/desktop-runtime run typecheck
npm --prefix engine/desktop-runtime run test:unit
npm --prefix engine/desktop-runtime run test:integration
```

Expected: PASS.

- [x] **Step 6: Commit**

```powershell
git add engine/domain-packs engine/desktop-runtime/src/renderer engine/desktop-runtime/tests/unit
git commit -m "feat: expose application and inventory actions in desktop UI"
```

---

### Task 2: Versioned Material Descriptor Catalog

**Files:**
- Create: `engine/desktop-runtime/standard-materials/catalog.json`
- Create: `engine/desktop-runtime/src/generator/material-descriptors.ts`
- Create: `engine/desktop-runtime/tests/unit/material-descriptors.test.ts`

**Interfaces:**
- Produces `loadMaterialDescriptorCatalog()` and `getMaterialDescriptor(templateId)`.
- Each descriptor contains exact `modulePurposes`, `operationLabels`, `validationNotes`, `workflowSteps`, `unsupportedClaims`, `screenshotScenarioIds`, and `coreEntityIds`.

- [x] **Step 1: Write failing strict catalog tests**

Assert eight exact template IDs, no unknown properties, every referenced module/entity/action exists in the runtime template descriptor, and no displayed label equals a stable action ID.

- [x] **Step 2: Define the exact primary workflow for each template**

Use these ordered flow summaries and fixed step IDs:

```text
application_approval_archive: create -> submit -> approve/reject -> revise -> approve -> archive
asset_inspection_management: asset -> plan -> task -> execute -> submit -> archive
asset_inspection_rectification: asset -> inspection -> abnormal result -> work order -> close -> archive
asset_work_order_operations: asset -> create order -> dispatch -> accept -> process -> resolve -> close
inspection_rectification_orders: inspection -> abnormal result -> work order -> close -> archive
inventory_application_approval: material/batch -> application -> submit -> approve -> deduct -> ledger
project_delivery_archive: project/task -> deliverable -> accept -> file archive -> close
project_task_management: project -> activate -> milestone/task -> risk -> deliverable -> close
```

- [x] **Step 3: Run and verify missing-catalog failure**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/material-descriptors.test.ts`

- [x] **Step 4: Implement strict Zod parsing, referential checks, deep freeze, and deterministic ordering**

Reject executable-looking keys, raw SQL/script content, duplicate step IDs, unknown role profiles, and flows without at least four steps.

- [x] **Step 5: Run tests and commit**

```powershell
npm --prefix engine/desktop-runtime run typecheck
node --import tsx --test engine/desktop-runtime/tests/unit/material-descriptors.test.ts
git add engine/desktop-runtime/standard-materials engine/desktop-runtime/src/generator/material-descriptors.ts engine/desktop-runtime/tests/unit/material-descriptors.test.ts
git commit -m "feat: add standard material descriptor catalog"
```

---

### Task 3: Strict MaterialFacts Builder and SQLite Introspection

**Files:**
- Create: `engine/desktop-runtime/src/generator/material-facts.ts`
- Create: `engine/desktop-runtime/tools/build-material-facts.cjs`
- Create: `engine/desktop-runtime/tests/unit/material-facts.test.ts`
- Create: `engine/desktop-runtime/tests/integration/material-facts-database.test.ts`
- Modify: `engine/desktop-runtime/package.json`

**Interfaces:**
- Produces `buildMaterialFacts(input): MaterialFacts` and canonical JSON CLI.
- CLI arguments: `--resources`, `--source-manifest`, `--screenshots`, `--acceptance`, `--template`, `--output`; every path is absolute and regular.
- `MaterialFacts.factVersion` is `1.0`.

- [x] **Step 1: Write failing fact-schema and truthfulness tests**

For all eight templates assert selected modules/entities/actions/roles are present, unselected template modules are absent, internal IDs have separate Chinese display labels, and project domain-command workflow steps are nonempty despite `blueprint.workflows=[]`. Add hostile fixtures containing unknown keys, absolute paths, credentials, executable-looking descriptor content, unsupported claims, and receipts whose hashes do not match; each must fail with a redacted issue code.

- [x] **Step 2: Write failing real SQLite introspection tests**

Apply compiled migrations to an in-memory `DatabaseSync`, then use `PRAGMA table_info`, `foreign_key_list`, `index_list`, and `index_info`. Assert every fact table/column/index/foreign key exists and no schema fact is inferred from prose.

- [x] **Step 3: Implement canonical fact assembly**

Verify project/resource locks before reading. Merge the descriptor only after exact ID checks. Store display labels separately from stable IDs. Store source/screenshot/evidence hashes without absolute paths.

- [x] **Step 4: Implement strict CLI publication**

Write through sibling staging, reject existing output, cap each input at its contract size, and print only `{ "ok": true }` plus a relative output name.

- [x] **Step 5: Run all fact tests for eight templates and commit**

```powershell
npm --prefix engine/desktop-runtime run typecheck
node --import tsx --test engine/desktop-runtime/tests/unit/material-facts.test.ts
node --import tsx --test engine/desktop-runtime/tests/integration/material-facts-database.test.ts
git add engine/desktop-runtime/src/generator/material-facts.ts engine/desktop-runtime/tools/build-material-facts.cjs engine/desktop-runtime/tests engine/desktop-runtime/package.json
git commit -m "feat: build verified material facts"
```

---

### Task 4: Twelve-to-Eighteen Screenshot Scenario Capture

**Files:**
- Modify: `engine/desktop-runtime/standard-materials/catalog.json`
- Modify: `engine/desktop-runtime/tools/capture-standard-screenshots.cjs`
- Modify: `engine/desktop-runtime/tools/capture-standard-screenshots.ps1`
- Create: `engine/desktop-runtime/src/generator/screenshot-evidence.ts`
- Create: `engine/desktop-runtime/tests/unit/screenshot-evidence.test.ts`
- Modify: `engine/desktop-runtime/tests/e2e/reference-acceptance.spec.ts`
- Modify: `engine/desktop-runtime/tests/e2e/inventory-application-acceptance.spec.ts`
- Modify: `engine/desktop-runtime/tests/e2e/project-actions-acceptance.spec.ts`

**Interfaces:**
- Screenshot manifest `2.0` contains 12–18 captures with `scenarioId`, `stepId`, role, module, action, stateBefore, stateAfter, executable/blueprint/image hashes, dimensions, and perceptual digest.
- Produces `assertScreenshotEvidence(manifest, facts)`.

- [x] **Step 1: Write failing count, hash, pixel, and duplicate tests**

Reject fewer than twelve or more than eighteen images, blank images, wrong executable/blueprint hash, missing target control, repeated scenario/step IDs, and perceptual digests below the configured difference threshold.

- [x] **Step 2: Extend the three representative packaged flows with capture checkpoints**

Asset remediation, inventory approval, and project task flows write screenshots before form submission, with the form open, and after persisted state change. Use themed module names from metadata and named accessible controls.

- [x] **Step 3: Add generic module, login, dashboard, backup, and minimum-width captures**

Fill remaining slots from the descriptor's selected modules without duplicating the representative flow images. Do not capture passwords or show plaintext credential fields.

- [x] **Step 4: Calculate image evidence and write manifest 2.0**

Use decoded RGBA sampling for blank/near-duplicate checks; do not compare compressed PNG bytes. Fail capture atomically and remove its output on any mismatch.

- [x] **Step 5: Run unit, syntax, and representative packaged screenshot tests**

Run:

```powershell
node --import tsx --test engine/desktop-runtime/tests/unit/screenshot-evidence.test.ts
node --check engine/desktop-runtime/tools/capture-standard-screenshots.cjs
npm --prefix engine/desktop-runtime run typecheck
```

- [x] **Step 6: Commit**

```powershell
git add engine/desktop-runtime/standard-materials engine/desktop-runtime/src/generator/screenshot-evidence.ts engine/desktop-runtime/tools engine/desktop-runtime/tests
git commit -m "feat: capture complete workflow screenshot evidence"
```

---

### Task 5: Deterministic Introduction, Feature Table, and Runtime Renderers

**Files:**
- Create: `engine/template-standard/materials/layout/base.css`
- Create: `engine/template-standard/materials/content/introduction.html`
- Replace: `engine/template-standard/materials/content/runtime.html`
- Create: `engine/template-standard/materials/content/feature-table.html`
- Create: `engine/lib/StandardMaterialRendering.psm1`
- Create: `engine/tests/StandardMaterialRendering.Tests.ps1`

**Interfaces:**
- Produces `Render-StandardIntroductionHtml`, `Render-StandardFeatureTableHtml`, and `Render-StandardRuntimeHtml` from `MaterialFacts` only.
- Shared cover uses software name, `【申请人填写】`, version, and generation date.

- [ ] **Step 1: Write failing required-section and no-internal-ID tests**

Assert introduction has purpose/users/scope/workflow/data/architecture/boundary sections; feature table has one table section per core module; runtime has installation/runtime/data/backup/offline/build/uninstall sections and two tables. Assert rendered user text contains no stable action IDs or bare field IDs.

- [ ] **Step 2: Add shared A4 styles**

Define Song/YaHei fonts, cover, H1/H2/H3 hierarchy, table header repetition, controlled page breaks, figure captions, header/footer space, and no negative spacing.

- [ ] **Step 3: Implement deterministic Chinese renderers**

Generate at least 1,200/2,500/800 non-whitespace characters respectively using fact-backed module purposes, operation labels, roles, validation notes, runtime versions, and boundaries. No filler repetition is allowed to satisfy counts.

- [ ] **Step 4: Run focused rendering tests and commit**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardMaterialRendering.Tests.ps1
git add engine/template-standard/materials engine/lib/StandardMaterialRendering.psm1 engine/tests/StandardMaterialRendering.Tests.ps1
git commit -m "feat: render fact-driven standard documents"
```

---

### Task 6: Detailed Operation Manual Renderer

**Files:**
- Modify: `engine/lib/StandardMaterialRendering.psm1`
- Replace: `engine/template-standard/materials/content/manual.html`
- Create: `engine/tests/StandardOperationManual.Tests.ps1`

**Interfaces:**
- Produces `Render-StandardManualHtml -Facts -ScreenshotRoot -OutputPath`.
- Every flow step renders prerequisites, numbered actions, expected result, failure behavior, and bound screenshot captions.

- [ ] **Step 1: Write failing manual depth tests**

Assert cover/install/login/roles/navigation/shared-controls/core-modules/workflow/backup/errors/uninstall/data-retention sections, at least 3,000 non-whitespace characters, one complete numbered flow, 12–18 distinct image paths, and zero raw stable action IDs.

- [ ] **Step 2: Implement screenshot-bound module and workflow sections**

Render one module section per descriptor core module. Render images only when their scenario/step and hashes match `MaterialFacts`; captions use Chinese operation labels.

- [ ] **Step 3: Render backup, recovery, common errors, and lifecycle guidance**

Use verified runtime/maintenance capabilities and do not claim export, networking, or password-change behavior unless present.

- [ ] **Step 4: Run focused tests and commit**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardOperationManual.Tests.ps1
git add engine/lib/StandardMaterialRendering.psm1 engine/template-standard/materials/content/manual.html engine/tests/StandardOperationManual.Tests.ps1
git commit -m "feat: render detailed standard operation manual"
```

---

### Task 7: Database Design and Prototype Diagram Generation

**Files:**
- Create: `engine/lib/StandardBusinessDiagrams.psm1`
- Replace: `engine/template-standard/materials/content/prototype.html`
- Create: `engine/template-standard/materials/content/database-design.html`
- Modify: `engine/lib/StandardMaterialRendering.psm1`
- Create: `engine/tests/StandardBusinessDiagrams.Tests.ps1`

**Interfaces:**
- Produces PNG navigation, list/detail/form, role matrix, workflow, and ER diagrams.
- Produces `Render-StandardPrototypeHtml` and `Render-StandardDatabaseHtml`.

- [ ] **Step 1: Write failing diagram and database truthfulness tests**

Assert five nonblank PNGs with stable dimensions, every core entity appears in ER/database tables, every rendered column/index/foreign key exists in schema facts, and unselected entities never appear.

- [ ] **Step 2: Generate diagrams with System.Drawing**

Use bounded grids, wrapped labels, measured text, consistent colors, arrows, and legends. Diagram captions identify their fact sources but expose no local paths.

- [ ] **Step 3: Render database dictionaries and transaction sections**

Create one field table per core business entity plus system-table overview, index/constraint tables, relationship descriptions, state fields, seed/version/backup sections, and at least 3,500 non-whitespace characters.

- [ ] **Step 4: Render prototype document around the five diagrams**

Include six to twelve pages worth of navigation, page structures, role-operation matrix, workflow, and ER explanation; ordinary screenshots are supplemental only.

- [ ] **Step 5: Run focused tests and commit**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessDiagrams.Tests.ps1
git add engine/lib/StandardBusinessDiagrams.psm1 engine/lib/StandardMaterialRendering.psm1 engine/template-standard/materials/content engine/tests/StandardBusinessDiagrams.Tests.ps1
git commit -m "feat: generate database and prototype materials"
```

---

### Task 8: Two-Page Nineteen-Field Applicant Form

**Files:**
- Replace: `engine/template-standard/materials/content/application-info.html`
- Modify: `engine/lib/StandardMaterialRendering.psm1`
- Modify: `engine/lib/StandardBusinessMaterials.psm1`
- Modify: `engine/template/tools/word-export-worker.ps1`
- Create: `engine/tests/StandardApplicantForm.Tests.ps1`

**Interfaces:**
- Produces the exact nineteen `data-field` values consumed by `Export-MaterialsApplicationForm`.
- Standard work item sets `ApplicationDocument=true` and uses `engine/template/materials/application-form-template.docx`.

- [ ] **Step 1: Write failing field, bookmark, marker, and page tests**

Assert nineteen exact fields, no extras, real Electron/SQLite/TypeScript facts, both required placeholders, all template bookmarks, at least one table, and exactly two final DOCX/PDF pages.

- [ ] **Step 2: Render fact-backed application values**

Populate software/runtime/language/purpose/industry/functions/technical fields from `MaterialFacts`. Keep abbreviation, classification, completion date, and organization date as applicant placeholders. Put measured source lines next to the source marker.

- [ ] **Step 3: Wire existing bookmark exporter**

Pass the real template path through the standard Word work item. Reject generic HTML export for `application-info`.

- [ ] **Step 4: Run real Word fixture test and commit**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardApplicantForm.Tests.ps1
git add engine/template-standard/materials/content/application-info.html engine/lib engine/template/tools/word-export-worker.ps1 engine/tests/StandardApplicantForm.Tests.ps1
git commit -m "fix: generate the standard two-page applicant form"
```

---

### Task 9: Canonical Sixty-Page Source Material

**Files:**
- Modify: `engine/lib/StandardBusinessSource.psm1`
- Create: `engine/lib/StandardSourceMaterial.psm1`
- Modify: `engine/template/tools/build-materials.ps1`
- Create: `engine/tests/StandardSourceMaterial.Tests.ps1`

**Interfaces:**
- Produces `Get-StandardSourcePrintPlan` with selected files/lines, canonical digest, expected pages, first/last ranges.
- Produces source HTML with explicit fifty-line page containers.

- [ ] **Step 1: Write failing short and long source-plan tests**

For 20 pages, select all. For 100 pages, select pages 1–30 and 71–100. Assert each full page contains 45–55 lines, selection is deterministic, and document/ZIP use the same manifest digest.

- [ ] **Step 2: Render explicit source pages instead of relying on Word repagination**

Each page is one fixed page-break container with line numbers, escaped code, header metadata, and page number. Do not delete a middle Word range after import.

- [ ] **Step 3: Verify final saved DOCX and PDF page counts**

Reopen DOCX after saving and count final pages. Count PDF page objects with a structured PDF reader or Word fixed-format verification. Fail if long material is not exactly sixty pages.

- [ ] **Step 4: Run tests and commit**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardSourceMaterial.Tests.ps1
git add engine/lib/StandardBusinessSource.psm1 engine/lib/StandardSourceMaterial.psm1 engine/template/tools/build-materials.ps1 engine/tests/StandardSourceMaterial.Tests.ps1
git commit -m "fix: enforce canonical sixty-page source materials"
```

---

### Task 10: Final DOCX/PDF Quality Inspector

**Files:**
- Create: `engine/lib/StandardDocumentQuality.psm1`
- Create: `engine/config/standard-document-quality.json`
- Create: `engine/tests/StandardDocumentQuality.Tests.ps1`

**Interfaces:**
- Produces `Test-StandardDocumentSet -Facts -DocumentRoot -ExpectedScreenshots` returning a redacted receipt.
- The quality config contains exact page/character/table/media limits from the design.

- [ ] **Step 1: Write failing malformed and thin-document tests**

Generate fixture DOCX/PDF files that are readable but too short, table-free, image-free, wrong-page, duplicate-image, wrong-title, or contain internal IDs/local paths. Assert each fails with document ID and redacted issue code.

- [ ] **Step 2: Implement post-save Word/OpenXML/PDF inspection**

Measure final pages, non-whitespace characters, paragraphs, tables, embedded media and hashes. Check required headings/bookmarks, software name/version, image uniqueness, and forbidden content. Never trust pre-export HTML counts.

- [ ] **Step 3: Emit a canonical material receipt**

Receipt binds facts hash, executable/resource/blueprint/source hashes, each document hash, measured metrics, screenshot digest, and status `passed`; it contains no absolute path.

- [ ] **Step 4: Run fixture tests and commit**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardDocumentQuality.Tests.ps1
git add engine/lib/StandardDocumentQuality.psm1 engine/config/standard-document-quality.json engine/tests/StandardDocumentQuality.Tests.ps1
git commit -m "feat: enforce final material quality gates"
```

---

### Task 11: Atomic Material Orchestration and Eighteen-File Publishing

**Files:**
- Rewrite: `engine/lib/StandardBusinessMaterials.psm1`
- Modify: `engine/lib/StandardBusinessOrchestrator.psm1`
- Modify: `engine/lib/StandardBusinessPublisher.psm1`
- Modify: `engine/config/standard-material-contract.json`
- Modify: `engine/tests/StandardBusinessMaterials.Tests.ps1`
- Modify: `engine/tests/StandardBusinessPublisher.Tests.ps1`

**Interfaces:**
- `Build-StandardBusinessMaterials` first builds `material-facts.json`, renders all documents under sibling staging, invokes Word workers, runs `Test-StandardDocumentSet`, and atomically promotes output.
- Standard publisher expects exactly eighteen artifacts and creates a seventeen-entry complete ZIP.

- [ ] **Step 1: Write failing exact eighteen-file contract tests**

Assert introduction, feature table, and database design names are required; staging has eighteen flat regular files; complete ZIP has seventeen entries; missing, extra, duplicate, reparse, old fifteen-file, or stale material receipt sets fail before publication.

- [ ] **Step 2: Replace placeholder rendering with the fact pipeline**

Invoke `build-material-facts.cjs`, all deterministic renderers, diagram generator, applicant exporter, source exporter, and Word workers. Render outputs under `.standard-materials.staging-<guid>` and remove it on every failure.

- [ ] **Step 3: Run final document quality inspection before packaging**

Use the returned material receipt in publisher evidence binding. Stop publication if any document hash or facts/source/screenshot hash differs.

- [ ] **Step 4: Update publisher copy map and validation report**

Copy all eleven material document names plus installer/source/evidence files. State measured page/image/table counts in the redacted validation report, not a generic success sentence.

- [ ] **Step 5: Run focused material and publisher tests and commit**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessMaterials.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessPublisher.Tests.ps1
git add engine/lib engine/config engine/tests
git commit -m "feat: publish eighteen-file verified materials"
```

---

### Task 12: Eight-Template Acceptance, Documentation, and Release Review

**Files:**
- Modify: `engine/tests/StandardBusinessAcceptance.Tests.ps1`
- Modify: `tools/Test-All.ps1`
- Modify: `README.md`
- Modify: `README.txt`
- Modify: `docs/generator-usage-and-filing-guide.md`
- Modify: `.gitignore`

**Interfaces:**
- `Test-All.ps1 -IncludeStandardBusinessAcceptance` validates the new material contract.

- [ ] **Step 1: Extend lightweight acceptance to all eight fact/document plans**

For all templates build resources and `MaterialFacts`; assert exact modules/workflows/schema/source facts and render every HTML/diagram without Word. Assert application/inventory/project action UI descriptors cover their primary flow. Run the existing `LegacyDemo` material contract test unchanged and assert it still publishes exactly twelve files.

- [ ] **Step 2: Run three representative complete workflow/material builds**

Asset remediation, inventory approval, and project task management each run packaged workflow screenshots and material rendering. Project task management additionally runs installer lifecycle and eighteen-file publication.

- [ ] **Step 3: Inspect representative outputs quantitatively and visually**

Open every DOCX/PDF, assert design bounds, compare screenshot pixels for nonblank/nonduplicate content, and inspect representative manual/application/database pages. Record metrics in the acceptance receipt.

- [ ] **Step 4: Update user documentation**

Document eighteen files, material page ranges, placeholder responsibilities, expected generation time, Word requirement, failure retention, and that videos are excluded.

- [ ] **Step 5: Run the full verification ladder**

```powershell
.\verify-dev.bat
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-All.ps1 -IncludeStandardBusinessAcceptance
rg -n -P "ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|RZ_PASSWORD=." . --glob '!docs/superpowers/**' --glob '!**/node_modules/**' --glob '!**/dist/**'
git diff --check
```

Expected: all checks pass; no secret/path scan matches; representative output satisfies every quality metric.

- [ ] **Step 6: Request final code review and resolve every Critical/Important finding**

Review from this plan commit through implementation head for truthfulness, document structure, screenshot evidence, source selection, security, and legacy compatibility. Re-run the owning test after every fix.

- [ ] **Step 7: Commit and push final acceptance**

```powershell
git add README.md README.txt docs/generator-usage-and-filing-guide.md tools/Test-All.ps1 .gitignore engine/tests/StandardBusinessAcceptance.Tests.ps1
git commit -m "test: verify evidence-driven copyright delivery"
git push origin feature/next-update
git status --short
```

Expected: clean `feature/next-update` synchronized with its remote.
