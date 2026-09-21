# Standard Business Generator Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default generator turn a user-confirmed supported theme into a tested, packaged Electron + SQLite business application assembled from production domain packs, while preserving the legacy four-page generator as an explicit mode.

**Architecture:** A static eight-template catalog and deterministic recommender sit in front of a new PowerShell standard-business orchestrator. Codex may produce only a schema-validated presentation profile; a generic Node resource assembler composes fixed production packs, roles, aliases, deterministic seeds, locks and runtime resources. The packaged application, screenshots, materials, installer and delivery evidence all derive from those locked resources.

**Tech Stack:** Windows PowerShell 5.1, Node.js 22.21.0, TypeScript 7, Zod 4, Electron 44, React 19, SQLite, Playwright 1.63, electron-builder 26, Word COM automation, NSIS.

**Spec:** `docs/superpowers/specs/2026-09-21-standard-business-generator-integration-design.md`

## Global Constraints

- `StandardBusiness` is the default interactive mode; `LegacyDemo` remains explicit and behaviorally compatible.
- Only the eight catalog templates are selectable; no arbitrary pack combinations or generated schemas.
- Theme profiles may change display text and synthetic vocabulary only, never IDs, fields, migrations, permissions, transitions, commands or transactions.
- Four distinct passwords are at least 12 characters and include uppercase, lowercase, number and special-character classes.
- Plaintext passwords never enter logs, resources, locks, reports, screenshots, source archives, installers or delivery archives.
- Standard projects use blueprint schema `1.0`, desktop runtime `1.0.0` and exact production pack versions `1.0.0`.
- Standard projects contain approximately 1000 counted business rows; identities, permissions, audit and migration rows are excluded.
- Standard failures never fall back to legacy mode and never publish partial delivery output.
- Renderer sandboxing, named preload APIs, context isolation and the Chromium sandbox remain enabled.
- Existing legacy generator, domain-pack and desktop-runtime test suites remain green.

---

### Task 1: Versioned Standard Template Catalog and Deterministic Recommendation

**Files:**
- Create: `engine/config/standard-business-templates.json`
- Create: `engine/lib/StandardBusinessCatalog.psm1`
- Create: `engine/tests/StandardBusinessCatalog.Tests.ps1`
- Modify: `engine/tests/Run-All.ps1`

**Interfaces:**
- Produces: `Get-StandardBusinessTemplates [-CatalogPath <absolute-json>]` returning deeply validated template objects.
- Produces: `Get-StandardBusinessRecommendation -Theme <string> -Templates <array>` returning `{ candidates, matched, scores, reasons }`.
- Template IDs and exact pack lists match the approved design.

- [ ] **Step 1: Write failing catalog and recommendation tests**

Test all eight IDs, exact pack selections, unique positive keywords, allowed view ranges, one clear match, one close tie and no-match behavior:

```powershell
$templates = @(Get-StandardBusinessTemplates)
Assert-Equal $templates.Count 8
Assert-Equal (($templates | ForEach-Object id) -join ',') `
  'application_approval_archive,asset_inspection_management,asset_inspection_rectification,asset_work_order_operations,inspection_rectification_orders,inventory_application_approval,project_delivery_archive,project_task_management'

$asset = Get-StandardBusinessRecommendation -Theme '校园消防设施巡检整改' -Templates $templates
Assert-Equal $asset.matched $true
Assert-Equal $asset.candidates[0].id 'asset_inspection_rectification'
Assert-Match ($asset.reasons -join ' ') '巡检'

$unknown = Get-StandardBusinessRecommendation -Theme '综合管理平台' -Templates $templates
Assert-Equal $unknown.matched $false
Assert-Equal $unknown.candidates.Count 8
```

- [ ] **Step 2: Run the focused test and verify missing-module failure**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessCatalog.Tests.ps1`

Expected: FAIL because `StandardBusinessCatalog.psm1` does not exist.

- [ ] **Step 3: Add the strict catalog JSON**

Each entry contains only:

```json
{
  "id": "asset_inspection_rectification",
  "name": "资产巡检整改",
  "packs": [
    "asset_registry",
    "inspection_rectification",
    "work_order_service",
    "asset_inspection_bridge",
    "asset_work_order_bridge",
    "inspection_work_order_bridge"
  ],
  "keywords": [
    { "value": "巡检", "weight": 8 },
    { "value": "点检", "weight": 8 },
    { "value": "整改", "weight": 7 },
    { "value": "设备", "weight": 3 },
    { "value": "资产", "weight": 3 }
  ],
  "primaryEntities": ["asset", "inspection_task", "work_order"],
  "roles": ["调度人员", "处理人员", "复核人员", "系统管理员"],
  "workflowSummary": "资产建档、巡检执行、异常整改、复核关闭和巡检归档",
  "viewRange": { "minimum": 12, "maximum": 13 }
}
```

Add the other seven exact mappings from the spec and sort entries by ID.

- [ ] **Step 4: Implement strict parsing and deterministic scoring**

Reject unknown properties, duplicate IDs, duplicate pack IDs, non-production pack IDs, invalid weights and empty summaries. Normalize theme whitespace and case, sum matching keyword weights, prefer more specific templates when scores tie, return at most two close candidates, and return all eight entries when the maximum score is below the catalog threshold.

- [ ] **Step 5: Run focused and existing PowerShell tests**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessCatalog.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add engine/config/standard-business-templates.json engine/lib/StandardBusinessCatalog.psm1 engine/tests
git commit -m "feat: add standard business template catalog"
```

---

### Task 2: Dual-Mode Interaction Request Resolution

**Files:**
- Create: `engine/lib/GenerationInteraction.psm1`
- Create: `engine/tests/GenerationInteraction.Tests.ps1`
- Modify: `engine/tests/Orchestrator.Tests.ps1`

**Interfaces:**
- Produces: `Resolve-GenerationMode`, `Select-StandardBusinessTemplate`, `Confirm-GenerationSummary` and `Resolve-GenerationRequest`, each accepting injectable reader functions for tests.
- `Resolve-GenerationRequest` returns an immutable `{ mode, theme, template }` value and creates no workspace or credentials.
- Preserves: the current `Generate.ps1` runtime entry until Task 12 atomically wires the completed standard orchestrator.

- [ ] **Step 1: Write failing interaction tests**

```powershell
$default = Resolve-GenerationMode -Mode '' -Reader { param($prompt) '' }
Assert-Equal $default 'StandardBusiness'

$legacy = Resolve-GenerationMode -Mode '' -Reader { param($prompt) '2' }
Assert-Equal $legacy 'LegacyDemo'

$selected = Select-StandardBusinessTemplate -Theme '实验室耗材申领' -Templates $templates `
  -Reader { param($prompt) '1' }
Assert-Equal $selected.id 'inventory_application_approval'

Assert-Throws {
  Select-StandardBusinessTemplate -Theme '综合管理平台' -Templates $templates -NonInteractive
} 'TemplateId'
```

Test that summary confirmation happens before credential collection and workspace initialization by using call-order recording scriptblocks.

- [ ] **Step 2: Run and verify missing interaction module**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/GenerationInteraction.Tests.ps1`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement mode, recommendation and confirmation prompts**

The default interactive sequence is mode, theme, recommendation, template selection and final summary confirmation. `LegacyDemo` skips template interaction. An explicit `StandardBusiness` request with theme/template values is non-interactive and rejects missing explicit values.

- [ ] **Step 4: Implement pure request resolution without changing the live entrypoint**

Compose the four interaction functions into `Resolve-GenerationRequest`. Assert through injected readers that confirmation occurs before credential/workspace callbacks. Do not modify the live default mode in this task; Task 12 wires the complete orchestrator and mode parameters in one green commit. Keep existing legacy orchestration tests unchanged.

- [ ] **Step 5: Run focused and legacy orchestration tests**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/GenerationInteraction.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Orchestrator.Tests.ps1
```

Expected: PASS; explicit `LegacyDemo` retains the current stage order.

- [ ] **Step 6: Commit**

```powershell
git add engine/lib/GenerationInteraction.psm1 engine/tests/GenerationInteraction.Tests.ps1 engine/tests/Orchestrator.Tests.ps1
git commit -m "feat: add standard and legacy generator modes"
```

---

### Task 3: Secure Four-Role Credential Collection

**Files:**
- Create: `engine/lib/StandardBusinessCredentials.psm1`
- Create: `engine/tests/StandardBusinessCredentials.Tests.ps1`
- Modify: `engine/desktop-runtime/tools/hash-password.cjs`
- Modify: `engine/desktop-runtime/tests/unit/passwords.test.ts`

**Interfaces:**
- Produces: `Test-InitialPasswordPolicy -Password <string>`.
- Produces: `Read-StandardBusinessCredentials -SecureReader <scriptblock> -DigestInvoker <scriptblock>` returning only four digests.
- Produces CLI: `node tools/hash-password.cjs --stdin`, reading one UTF-8 line and printing one digest.

- [ ] **Step 1: Write failing policy, uniqueness and leak tests**

Test minimum length, four character classes, mismatched confirmation, duplicate role passwords, digest-only output and absence of plaintext in captured output/errors:

```powershell
Assert-Equal (Test-InitialPasswordPolicy 'StrongPass123!') $true
Assert-Equal (Test-InitialPasswordPolicy 'weakpassword') $false

$result = Read-StandardBusinessCredentials -SecureReader $fakeReader -DigestInvoker $fakeHasher
Assert-Equal (($result.PSObject.Properties.Name | Sort-Object) -join ',') `
  'administrator,dispatcher,operator,reviewer'
Assert-Match $result.dispatcher '^scrypt\$16384\$8\$1\$'
Assert-Equal (($result | ConvertTo-Json) -match 'StrongPass123!') $false
```

- [ ] **Step 2: Run tests and verify missing functions/CLI option**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessCredentials.Tests.ps1
cd engine/desktop-runtime
node --import tsx --test tests/unit/passwords.test.ts
```

Expected: credential PowerShell test fails because the module is missing; Node test fails because `--stdin` is unsupported.

- [ ] **Step 3: Implement secure input and digest-only result**

Use `Read-Host -AsSecureString`, `Marshal.SecureStringToBSTR`, a `try/finally` zero-free block, and the stdin hasher. Compare confirmation and uniqueness while plaintext values are in the narrow local scope. Do not include plaintext in thrown errors.

- [ ] **Step 4: Extend the hash CLI safely**

`--stdin` accepts exactly one non-empty line, rejects trailing input, invokes the existing `hashPassword`, writes only the digest and clears the local string reference in `finally`. Existing `RZ_PASSWORD` behavior remains for release tooling compatibility.

- [ ] **Step 5: Verify focused tests and token/password scans**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessCredentials.Tests.ps1
cd engine/desktop-runtime
npm run test:unit
cd ../..
$scanRoots = @('engine/日志', '交付结果') | Where-Object { Test-Path -LiteralPath $_ }
if ($scanRoots.Count -gt 0) { rg -n "StrongPass123!" $scanRoots -g '*' }
```

Expected: tests pass and the scan has no matches.

- [ ] **Step 6: Commit**

```powershell
git add engine/lib/StandardBusinessCredentials.psm1 engine/tests engine/desktop-runtime/tools/hash-password.cjs engine/desktop-runtime/tests/unit/passwords.test.ts
git commit -m "feat: collect standard business credentials securely"
```

---

### Task 4: Strict Theme Presentation Profile and One Repair Attempt

**Files:**
- Create: `engine/config/theme-profile.schema.json`
- Create: `engine/config/theme-profile-contract.md`
- Create: `engine/tools/build-theme-profile-validator.cjs`
- Create: `engine/theme-profile/validator.cjs`
- Create: `engine/lib/ThemeProfile.psm1`
- Create: `engine/tests/ThemeProfile.Tests.ps1`
- Modify: `engine/package.json`
- Modify: `engine/tests/CodexRunner.Tests.ps1`

**Interfaces:**
- Produces: `Test-ThemeProfile -Path <json> -Template <object>` returning frozen normalized data or issues.
- Produces: `Invoke-ThemeProfileGeneration -Context -Template -CodexPath` with at most one repair.
- Profile keys are exactly `softwareName`, `purpose`, `industry`, `entityAliases`, `moduleAliases`, `seedVocabulary`.

- [ ] **Step 1: Write failing validator and Codex-boundary tests**

Cover valid aliases, unknown IDs, overlong text, identity fields, HTML, URL, filesystem path, `script`, `sql`, `command`, accessor-looking keys and extra properties. Assert the Codex prompt contains the selected template's exact aliasable IDs and forbids domain changes.

- [ ] **Step 2: Run and verify missing schema/module failures**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/ThemeProfile.Tests.ps1`

Expected: FAIL because the schema and module are absent.

- [ ] **Step 3: Add schema and standalone validator build**

Use AJV with strict mode and `additionalProperties: false`. Compile a checked-in standalone validator so normal generation does not need dynamic schema compilation. Cap each display value at 80 characters, purpose at 240, industry at 80, vocabulary arrays at 20 entries and 40 characters per entry.

- [ ] **Step 4: Add isolated Codex generation and one repair**

Codex may write only `theme-profile.json` in a profile staging directory. Validate after generation; if invalid, invoke one repair with a redacted bounded issue summary. The second failure terminates the standard pipeline. Delete prompt/stdout/stderr intermediates as the current Codex runner does.

- [ ] **Step 5: Run validator build and focused/full engine tests**

Run:

```powershell
npm --prefix engine run build:theme-profile-validator
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/ThemeProfile.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add engine/config/theme-profile* engine/tools/build-theme-profile-validator.cjs engine/theme-profile engine/lib/ThemeProfile.psm1 engine/tests engine/package.json engine/package-lock.json
git commit -m "feat: constrain generated theme presentation profiles"
```

---

### Task 5: Generic Standard Project Descriptors and Composite Roles

**Files:**
- Create: `engine/desktop-runtime/standard-templates/catalog.json`
- Create: `engine/desktop-runtime/src/generator/standard-project.ts`
- Create: `engine/desktop-runtime/tests/unit/standard-project.test.ts`
- Modify: `engine/desktop-runtime/reference/asset-operations/project.json`

**Interfaces:**
- Produces type: `StandardProjectRequest { templateId, appId, software, profile, passwordDigests, seed }`.
- Produces: `createStandardProject(request, templateCatalog, composedBlueprint)`.
- Template descriptors include pack configs, role-profile source IDs, seed plan, coverage and material facts.

- [ ] **Step 1: Write failing descriptor and role-union tests**

Assert eight descriptors match the engine catalog, use exact `1.0.0` pack versions, reference only roles present after composition, and produce exactly four composite roles. For the asset reference mapping assert:

```ts
assert.deepEqual(project.roleProfiles.operations_dispatcher.sources, [
  'asset_viewer', 'inspection_planner', 'work_order_dispatcher'
]);
assert.deepEqual(project.roleProfiles.operations_operator.sources, [
  'asset_viewer', 'inspection_executor', 'work_order_handler'
]);
assert.deepEqual(project.roleProfiles.operations_reviewer.sources, [
  'asset_viewer', 'inspection_reviewer', 'work_order_reviewer'
]);
```

- [ ] **Step 2: Run and verify missing generator module**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/standard-project.test.ts`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Add eight exact runtime descriptors**

Each descriptor repeats the approved pack mapping and declares role sources, maintenance availability, seed counts totaling 1000 after bridge rows, material coverage and aliasable entity/module IDs.

- [ ] **Step 4: Implement project normalization and role unions**

Resolve source roles from the composed blueprint, union permissions deterministically, reject unknown/duplicate sources, append `maintenance.backup` and `maintenance.restore` only to `operations_admin`, and revalidate the final blueprint.

- [ ] **Step 5: Run typecheck and focused tests**

Run:

```powershell
cd engine/desktop-runtime
npm run typecheck
node --import tsx --test tests/unit/standard-project.test.ts
```

Expected: PASS for all eight descriptors.

- [ ] **Step 6: Commit**

```powershell
git add engine/desktop-runtime/standard-templates engine/desktop-runtime/src/generator engine/desktop-runtime/tests/unit/standard-project.test.ts engine/desktop-runtime/reference/asset-operations/project.json
git commit -m "feat: define standard business project descriptors"
```

---

### Task 6: Deterministic Eight-Template Seed Assembly

**Files:**
- Create: `engine/desktop-runtime/src/generator/standard-seed.ts`
- Create: `engine/desktop-runtime/src/generator/theme-seed-aliases.ts`
- Create: `engine/desktop-runtime/tests/unit/standard-seed.test.ts`
- Create: `engine/desktop-runtime/tests/integration/standard-seed-database.test.ts`
- Modify: `engine/desktop-runtime/reference/asset-operations/generate-seed.ts`

**Interfaces:**
- Produces: `generateStandardSeed(project, blueprint): RuntimeSeed`.
- Produces exactly 1000 counted business rows for every template.
- Preserves core pack IDs/references and changes only whitelisted synthetic text fields.

- [ ] **Step 1: Write failing per-template count and reference tests**

For all eight templates, generate twice and compare canonical bytes, sum `report.counts` to `1000`, assert four digest-only users, unique codes and valid references. Assert different presentation vocabulary changes labels but not IDs, statuses, row counts or reference topology.

- [ ] **Step 2: Run and verify missing seed assembler**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/standard-seed.test.ts`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Compose existing production seed generators**

Call the six production seed APIs with descriptor-owned counts. Normalize their outputs into the runtime `records` map. Add bridge rows only where the selected bridge owns a persisted relation. Allocate counts explicitly in the catalog so each final total is exactly 1000; never pad with fake audit or identity rows.

- [ ] **Step 4: Apply safe vocabulary aliases**

Maintain an explicit mapping of aliasable textual fields such as asset/material/project names, descriptions, findings and reasons. Do not alter codes, reference fields, statuses, dates, versions, digests or numeric balances.

- [ ] **Step 5: Seed real SQLite for all eight templates**

Compile every blueprint, migrate a temporary database, call `seedProjectData` twice, verify idempotency, foreign keys, per-table counts, four users and no plaintext password match.

- [ ] **Step 6: Run focused and desktop tests**

Run:

```powershell
cd engine/desktop-runtime
npm run typecheck
node --import tsx --test tests/unit/standard-seed.test.ts tests/integration/standard-seed-database.test.ts
npm run test:unit
npm run test:integration
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add engine/desktop-runtime/src/generator engine/desktop-runtime/reference/asset-operations/generate-seed.ts engine/desktop-runtime/tests
git commit -m "feat: assemble deterministic standard project seeds"
```

---

### Task 7: Generic Locked Runtime Resource Assembler

**Files:**
- Create: `engine/desktop-runtime/src/generator/resource-assembler.ts`
- Create: `engine/desktop-runtime/tools/build-standard-resources.cjs`
- Create: `engine/desktop-runtime/tests/integration/standard-resources.test.ts`
- Modify: `engine/desktop-runtime/tools/build-project-resources.cjs`
- Modify: `engine/desktop-runtime/package.json`

**Interfaces:**
- CLI: `build-standard-resources --request <absolute-json> --output <absolute-directory>`.
- Produces: canonical `blueprint.json`, `seed.json`, `domain-lock.json`, `project.lock.json`, `production-runtime-catalog.cjs`, `resource-manifest.json`.
- `build-project-resources.cjs` becomes a compatibility wrapper over the generic assembler.

- [ ] **Step 1: Write failing eight-template resource tests**

Build every template twice with fixed digests and assert byte equality for every resource, valid locks, six required files, exact selected packs, 1000 rows and no fixture digests. Test partial/malformed digests, unknown template, unknown aliases, output traversal, nonempty output and one-byte tampering.

- [ ] **Step 2: Run and verify missing generic CLI**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/integration/standard-resources.test.ts`

Expected: FAIL because `build-standard-resources.cjs` is absent.

- [ ] **Step 3: Extract the reference assembler into a typed module**

Move canonical JSON, composition request, role assembly, seed assembly, lock creation, catalog bundle and atomic directory promotion behind `assembleStandardResources(request, outputPath)`. Resolve pack roots only under `engine/domain-packs/packs` and reject reparse points.

- [ ] **Step 4: Add strict CLI and compatibility wrapper**

The generic CLI accepts only absolute regular request/output paths and returns exit `0` success, `1` validated business rejection and `2` invocation/filesystem failure. The reference wrapper converts its current project JSON into a standard request without changing existing scripts.

- [ ] **Step 5: Run deterministic resource, project-lock and reference tests**

Run:

```powershell
cd engine/desktop-runtime
npm run typecheck
node --import tsx --test tests/integration/standard-resources.test.ts tests/integration/reference-resources.test.ts tests/unit/project-lock.test.ts
npm run build:reference
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add engine/desktop-runtime/src/generator engine/desktop-runtime/tools engine/desktop-runtime/tests engine/desktop-runtime/package.json
git commit -m "feat: assemble locked resources for standard templates"
```

---

### Task 8: Parameterized Desktop Build and NSIS Packaging

**Files:**
- Create: `engine/desktop-runtime/tools/build-standard-desktop.ps1`
- Create: `engine/desktop-runtime/tools/write-builder-config.cjs`
- Create: `engine/desktop-runtime/tests/integration/standard-package-contract.test.ts`
- Modify: `engine/desktop-runtime/electron-builder.reference.yml`
- Modify: `engine/desktop-runtime/tools/verify-package.cjs`
- Modify: `engine/desktop-runtime/tools/verify-installer.ps1`
- Modify: `engine/desktop-runtime/package.json`

**Interfaces:**
- CLI: `build-standard-desktop.ps1 -RequestPath <absolute-json> -OutputRoot <absolute-directory> [-UnpackedOnly]`.
- Generates builder configuration from locked software name, version and app ID.
- Returns a machine-readable receipt with installer/unpacked paths and hashes, never credentials.

- [ ] **Step 1: Write failing package contract tests**

Assert two differently named requests generate distinct product names, executable names, app IDs and artifact names while retaining sandbox/asar/NSIS safety settings. Test path traversal, reserved Windows names and executable-name collisions.

- [ ] **Step 2: Run and verify missing build tools**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/integration/standard-package-contract.test.ts`

Expected: FAIL because the config writer and script are absent.

- [ ] **Step 3: Implement canonical builder config generation**

Read verified resources, derive `productName`, exact `1.0.0` version and deterministic app ID from the locked project ID, write a workspace-local YAML config and retain the existing `asar`, sandbox, x64 assisted NSIS and user-data preservation settings.

- [ ] **Step 4: Build from workspace resources without mutating repository dist**

Parameterize build output, Electron resources and report directories. Copy runtime build output and locked resources into a sibling staging tree, package there, and atomically promote only completed output. Do not call `clean-installers.cjs` against the shared repository path.

- [ ] **Step 5: Generalize package and installer verification**

Discover software metadata from packaged `blueprint.json`, reject fixture digests/plaintext secrets/databases/logs/screenshots, bind receipts to executable and packaged manifest hashes, isolate `APPDATA`, `LOCALAPPDATA` and runtime user data, and retain native-crash retry filtering.

- [ ] **Step 6: Build and verify two fixture packages**

Run the asset reference and project-task fixture in `-UnpackedOnly` mode, execute packaged `--verify`, and assert no cross-project output collision. Run one full NSIS lifecycle fixture.

- [ ] **Step 7: Commit**

```powershell
git add engine/desktop-runtime/tools engine/desktop-runtime/tests/integration/standard-package-contract.test.ts engine/desktop-runtime/electron-builder.reference.yml engine/desktop-runtime/package.json
git commit -m "feat: parameterize standard desktop packaging"
```

---

### Task 9: Packaged Acceptance Matrix and Restart Persistence

**Files:**
- Create: `engine/desktop-runtime/tests/e2e/standard-template-smoke.spec.ts`
- Create: `engine/desktop-runtime/tests/e2e/inventory-application-acceptance.spec.ts`
- Create: `engine/desktop-runtime/tests/e2e/project-archive-acceptance.spec.ts`
- Create: `engine/desktop-runtime/tools/standard-e2e-flow.source.js`
- Modify: `engine/desktop-runtime/tests/e2e/reference-acceptance.spec.ts`
- Modify: `engine/desktop-runtime/tools/reference-e2e-flow.source.js`
- Modify: `engine/desktop-runtime/playwright.config.ts`

**Interfaces:**
- Environment: `RZ_E2E_TEMPLATE_ID`, `RZ_E2E_EXECUTABLE_PATH`, four role passwords, isolated user-data path.
- Produces per-template receipt with template ID, executable hash, packaged manifest hash, workflow status and restart status.

- [ ] **Step 1: Write failing shared smoke and two composite-flow tests**

Smoke all eight packaged templates: login four roles, load metadata, visit every module, read dashboard, create backup, close, inspect SQLite, restart and revisit one persisted record. Add full inventory/application approval-to-deduction and project/delivery-to-archive-to-close flows with permission denials and blockers.

- [ ] **Step 2: Run against current reference-only tooling**

Run: `cd engine/desktop-runtime; npx playwright test tests/e2e/standard-template-smoke.spec.ts`

Expected: FAIL because generic template launch resources and flow driver are missing.

- [ ] **Step 3: Extract a shared packaged driver**

Move login, named preload calls, UI navigation, process close/restart, SQLite subprocess checks and receipt hashing into a runtime-loaded source file outside Playwright's transformed test tree. Keep domain-specific flows separate and declarative.

- [ ] **Step 4: Implement three full composite workflows**

Retain asset/inspection/work-order behavior, add inventory application approval with exactly-once ledger deduction and rollback assertions, and add project delivery archive with close blockers, accepted latest version and immutable archive relation.

- [ ] **Step 5: Run packaged matrix with ephemeral credentials**

Use the standard packaging script in unpacked mode for all eight templates. Run smoke for each and full flows for the three composite templates. Require every receipt to bind to the exact tested executable and packaged resource manifest.

- [ ] **Step 6: Commit**

```powershell
git add engine/desktop-runtime/tests/e2e engine/desktop-runtime/tools/*e2e* engine/desktop-runtime/playwright.config.ts
git commit -m "test: verify packaged standard template matrix"
```

---

### Task 10: Metadata-Driven Electron Screenshots and Business Materials

**Files:**
- Create: `engine/desktop-runtime/tools/capture-standard-screenshots.ps1`
- Create: `engine/lib/StandardBusinessMaterials.psm1`
- Create: `engine/lib/StandardBusinessSource.psm1`
- Create: `engine/config/standard-material-contract.json`
- Create: `engine/template-standard/materials/content/application-info.html`
- Create: `engine/template-standard/materials/content/manual.html`
- Create: `engine/template-standard/materials/content/runtime.html`
- Create: `engine/template-standard/materials/content/prototype.html`
- Create: `engine/tests/StandardBusinessMaterials.Tests.ps1`
- Modify: `engine/template/tools/word-export-worker.ps1`

**Interfaces:**
- Screenshot tool consumes packaged executable, credentials, verified blueprint and output directory.
- `Get-StandardSourceManifest` returns the exact sorted source-file set and source-line metric used by both materials and the source ZIP.
- `Build-StandardBusinessMaterials` consumes context, blueprint, lock, profile, screenshots, source metrics and verification receipt.
- Produces operation manual DOCX/PDF, source DOCX/PDF, application form DOCX/PDF, environment DOCX and prototype DOCX.

- [ ] **Step 1: Write failing material truthfulness and screenshot-plan tests**

Assert screenshot plan uses real blueprint module IDs, output includes dashboard/list/detail/action states, material text contains every selected module and no unselected module, application form retains both applicant/source-count markers, and no local path/password/token appears.

- [ ] **Step 2: Run and verify missing standard material module**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessMaterials.Tests.ps1`

Expected: FAIL because the module/templates are absent.

- [ ] **Step 3: Implement packaged Electron screenshot capture**

Use Playwright Electron with isolated user data and role-aware navigation. Derive a bounded screenshot list from final modules and domain actions, use stable accessible selectors, and write a screenshot manifest with module/action IDs and hashes.

- [ ] **Step 4: Build materials from verified facts only**

Create the deterministic source manifest before material rendering. Render HTML from locked blueprint/profile/receipts, reuse the existing Word worker for DOCX/PDF export, calculate source quantity from that manifest, and keep applicant/publication fields as explicit fill-in markers. Reject material facts not traceable to blueprint, profile or verification evidence.

- [ ] **Step 5: Run fixture material generation and inspect artifacts**

Generate materials for the asset reference and inventory application fixtures. Verify required fields, image dimensions, PDF page count bounds, DOCX readability and absence of unsupported claims.

- [ ] **Step 6: Commit**

```powershell
git add engine/desktop-runtime/tools/capture-standard-screenshots.ps1 engine/lib/StandardBusinessMaterials.psm1 engine/lib/StandardBusinessSource.psm1 engine/config/standard-material-contract.json engine/template-standard engine/template/tools/word-export-worker.ps1 engine/tests/StandardBusinessMaterials.Tests.ps1
git commit -m "feat: generate materials from packaged business apps"
```

---

### Task 11: Standard Delivery Contract and Evidence-Bound Publishing

**Files:**
- Create: `engine/lib/StandardBusinessPublisher.psm1`
- Create: `engine/tests/StandardBusinessPublisher.Tests.ps1`
- Modify: `engine/lib/Publisher.psm1`
- Modify: `engine/tests/Publisher.Tests.ps1`

**Interfaces:**
- Produces: `Get-ExpectedStandardArtifactNames -Context`.
- Produces: `New-StandardSourceArchive`, `New-StandardDeliveryStaging`, `Publish-StandardDelivery`.
- Consumes: `Get-StandardSourceManifest` from Task 10 and rejects a source set/hash that differs from the material receipt.
- Adds blueprint, domain lock and acceptance report to the existing material set.

- [ ] **Step 1: Write failing exact-artifact and secret-exclusion tests**

Build a fixture staging set and assert exact names, flat layout, readable complete ZIP containing every other artifact, no overwrite, no reparse points, no temporary builder files, no database/log/password/token and correct SHA-256 evidence bindings.

- [ ] **Step 2: Run and verify missing standard publisher**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessPublisher.Tests.ps1`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement standard source archive**

Include the reusable desktop runtime source, exact generated project request/profile, blueprint, locks, resource manifest, production pack source needed by selected packs, package manifests and rebuild instructions. Exclude `node_modules`, `dist`, databases, credentials, test results and absolute paths.

- [ ] **Step 4: Implement evidence-bound staging and publication**

Require installer/package/E2E/material receipts to share the same executable and resource hashes. Generate a redacted validation report, create the complete ZIP last, require a flat regular-file directory and atomically publish with the current timestamp/counter collision behavior.

- [ ] **Step 5: Run standard and legacy publisher tests**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessPublisher.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Publisher.Tests.ps1
```

Expected: PASS; legacy remains exactly twelve files.

- [ ] **Step 6: Commit**

```powershell
git add engine/lib/StandardBusinessPublisher.psm1 engine/lib/Publisher.psm1 engine/tests
git commit -m "feat: publish standard business delivery evidence"
```

---

### Task 12: Standard Business Orchestrator Integration

**Files:**
- Create: `engine/lib/StandardBusinessOrchestrator.psm1`
- Create: `engine/tests/StandardBusinessOrchestrator.Tests.ps1`
- Modify: `engine/Generate.ps1`
- Modify: `engine/tests/Orchestrator.Tests.ps1`
- Modify: `engine/lib/Dependencies.psm1`

**Interfaces:**
- Produces: `Invoke-StandardBusinessOrchestration -Context -Template -CredentialDigests -StageOverrides -KeepSuccessfulWorkspace`.
- Executes the fourteen approved standard stages in exact order.
- Reuses current logging and safe-path semantics without invoking legacy generation/validation/build stages.

- [ ] **Step 1: Write failing stage-order, cleanup and no-fallback tests**

Inject every stage action, record order, assert state handoff and final delivery. Inject failure at each stage and assert the correct stage name, exit code, no publication, redacted log and post-initialize workspace retention. Assert standard failure never invokes the legacy orchestrator.

- [ ] **Step 2: Run and verify missing orchestrator**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessOrchestrator.Tests.ps1`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement orchestrator state and stage adapters**

State contains context, template, profile, digests, composition, resources, build receipt, acceptance receipts, screenshots, materials, installer, source archive, staging and delivery. Each stage validates the preceding receipt before invocation. Password digests are removed from state immediately after atomic resource publication.

- [ ] **Step 4: Wire standard mode into `Generate.ps1`**

Complete the Task 2 dispatch point. Interactive flow performs recommendation/confirmation before credentials and workspace creation. Non-interactive flow requires explicit mode, theme, template and digest inputs. `PreflightOnly` remains prompt-free when theme is supplied.

- [ ] **Step 5: Run focused, full engine and legacy tests**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessOrchestrator.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Orchestrator.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add engine/lib/StandardBusinessOrchestrator.psm1 engine/Generate.ps1 engine/lib/Dependencies.psm1 engine/tests
git commit -m "feat: integrate standard business generation pipeline"
```

---

### Task 13: Full Eight-Template Acceptance, Documentation and Release Hygiene

**Files:**
- Create: `engine/tests/StandardBusinessAcceptance.Tests.ps1`
- Modify: `README.md`
- Modify: `README.txt`
- Modify: `docs/generator-usage-and-filing-guide.md`
- Modify: `tools/Test-All.ps1`
- Modify: `.gitignore`

**Interfaces:**
- Adds `Test-All.ps1 -IncludeStandardBusinessAcceptance`.
- Documents the exact interactive flow, eight templates, password handoff and standard delivery artifacts.

- [ ] **Step 1: Write failing black-box acceptance tests**

For all eight templates invoke non-interactive standard generation with fixed test digests and temporary output. Assert successful composition/resources for all eight; full packaged workflows for the three composite templates; smoke/restart for the other five; actual screenshot/material/installer output for one representative template; no legacy routes/files in standard source output.

- [ ] **Step 2: Run and capture remaining integration failures**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/StandardBusinessAcceptance.Tests.ps1`

Expected: initial failures identify only incomplete cross-task wiring; fix the smallest owning module for each concrete failure and rerun after every fix.

- [ ] **Step 3: Update user and developer documentation**

Document default standard mode, all eight templates, recommendation/confirmation, password retention responsibility, explicit legacy selection, expected generation time/network/tool requirements, new delivery files, failure recovery and exact automation syntax. Remove the current statement that the Electron/domain-pack path is not integrated.

- [ ] **Step 4: Extend unified verification and repository hygiene**

Add the standard acceptance switch without making network/GUI acceptance part of default `verify-dev.bat`. Ignore generated standard workspaces, screenshots, databases, reports, installers and credential intermediates. Scan source and tracked files for plaintext test/release passwords, tokens and local absolute paths.

- [ ] **Step 5: Run the complete verification ladder**

Run:

```powershell
.\verify-dev.bat
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-All.ps1 -IncludeE2E
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-All.ps1 -IncludeStandardBusinessAcceptance
rg -n -P "ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|RZ_PASSWORD=." . --glob '!docs/superpowers/**' --glob '!**/node_modules/**' --glob '!**/dist/**'
git diff --check
```

Expected: every test/build exits `0`; secret scan has no values; only intended source/docs changes remain.

- [ ] **Step 6: Request final code review and fix every Critical/Important finding**

Review the full range from this plan commit to the implementation head. Re-run the owning focused test after each review fix, then repeat Step 5.

- [ ] **Step 7: Commit final acceptance**

```powershell
git add README.md README.txt docs/generator-usage-and-filing-guide.md tools/Test-All.ps1 .gitignore engine/tests/StandardBusinessAcceptance.Tests.ps1
git commit -m "test: complete standard business generator acceptance"
```

- [ ] **Step 8: Review branch before integration**

Run:

```powershell
git status --short
git log --oneline --decorate -20
git diff --check origin/feature/next-update...HEAD
```

Expected: clean worktree, thirteen scoped implementation commits after this plan, and no whitespace errors.
