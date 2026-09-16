# Blueprint Protocol and Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned business-blueprint protocol, archetype/plugin catalog, structural and semantic validator, CLI, and PowerShell bridge that can reject unsafe or unsupported blueprints before project generation starts.

**Architecture:** Keep blueprint logic in focused CommonJS modules under `engine/blueprint` so it can later be reused by the Electron wizard and invoked today by PowerShell. Use JSON Schema Draft 2020-12 and Ajv only at development time to generate a checked-in standalone structural validator; production validation then needs only the existing Node runtime. Return stable machine-readable issue codes and separate structural validity (`valid`) from generation eligibility (`canGenerate`).

**Tech Stack:** Node.js 22, CommonJS, `node:test`, JSON Schema Draft 2020-12, Ajv 8.17.1 standalone generation, PowerShell 5.1 bridge and existing PowerShell test harness.

**Spec:** `docs/superpowers/specs/2026-09-16-config-driven-generator-design.md`

## Global Constraints

- This plan implements only sub-project 1, “蓝图协议与校验器”; it does not build the Electron runtime, domain plugins, desktop wizard, or material generator.
- The blueprint is the only generation contract between the model and the future runtime.
- Models may select only registered archetypes and plugins; they may not provide executable scripts.
- Unsupported requirements are reported explicitly and make `canGenerate` false.
- The model-repair loop is outside this plan; the validator must provide stable issue codes and paths for that later integration.
- Production validation must run offline with the existing Node dependency and without `npm install`.
- All identifiers use lower `snake_case`; all user-facing labels remain UTF-8 Chinese strings.
- Existing generation, validation, packaging, and material behavior must continue to pass the current full PowerShell suite.

---

## File Map

**Protocol and catalogs**

- Create `engine/config/blueprint.schema.json`: complete version `1.0` structural contract.
- Create `engine/config/archetypes.json`: six registered archetypes and their allowed plugin IDs.
- Create `engine/config/plugins.json`: supported plugin descriptors and compatible archetypes.
- Create `engine/blueprint/generated/validate-blueprint-structure.cjs`: checked-in Ajv standalone output; generated, never hand-edited.

**Validator implementation**

- Create `engine/blueprint/issues.cjs`: stable issue construction, sorting, and summary formatting.
- Create `engine/blueprint/catalog.cjs`: load and validate immutable archetype/plugin catalogs.
- Create `engine/blueprint/references.cjs`: entity, module, relation, permission, dashboard, and plugin reference checks.
- Create `engine/blueprint/workflows.cjs`: graph reachability, terminal reachability, and transition-permission checks.
- Create `engine/blueprint/retention.cjs`: delete-policy and history-retention checks.
- Create `engine/blueprint/validate.cjs`: compose structural and semantic validation into one result.
- Create `engine/blueprint/cli.cjs`: file-based JSON CLI with deterministic JSON output and exit codes.
- Create `engine/lib/BlueprintValidation.psm1`: safe PowerShell invocation and typed result parsing.

**Build and tests**

- Create `engine/package.json` and `engine/package-lock.json`: developer-only Ajv build dependency and Node test/build scripts.
- Create `engine/tools/build-blueprint-validator.cjs`: deterministic standalone-validator generator.
- Create `engine/tests/blueprint/*.test.js`: focused Node tests for every validator unit.
- Create `engine/tests/fixtures/blueprints/*.json`: valid composite blueprint and invalid focused fixtures.
- Create `engine/tests/BlueprintValidation.Tests.ps1`: CLI and PowerShell bridge contract tests.
- Modify `engine/tests/Run-All.ps1`: no code change expected because it already discovers root `*.Tests.ps1`; verify discovery explicitly.
- Modify `README.txt`: document the blueprint-validator developer commands only after the validator exists.

---

### Task 1: Pin the Schema Compiler and Generate a Standalone Validator

**Files:**
- Create: `engine/package.json`
- Create: `engine/package-lock.json`
- Create: `engine/tools/build-blueprint-validator.cjs`
- Create: `engine/config/blueprint.schema.json`
- Create: `engine/blueprint/generated/validate-blueprint-structure.cjs`
- Test: `engine/tests/blueprint/structure.test.js`

**Interfaces:**
- Consumes: `engine/config/blueprint.schema.json` with `$id` `https://local.rz-project/schema/blueprint-1.0.json`.
- Produces: `validateStructure(value) -> boolean`; Ajv errors are available as `validateStructure.errors`.

- [ ] **Step 1: Add the failing structural contract test**

Create `engine/tests/blueprint/structure.test.js` with tests that require the generated validator, accept the smallest valid blueprint, reject an unknown top-level property, reject a camelCase ID, reject an unsupported field type, and reject a missing required top-level section. Cross-object ID uniqueness belongs to Task 3 semantic validation, not JSON Schema. Use this minimal valid object in the test:

```js
const minimalBlueprint = {
  schemaVersion: '1.0',
  software: {
    id: 'equipment_inspection',
    name: '设备点检管理软件',
    version: '1.0.0',
    purpose: '管理设备点检与异常闭环',
    targetUsers: ['设备管理员'],
    boundaries: ['不连接生产设备'],
    loginMode: 'required'
  },
  archetypes: ['asset_registry', 'inspection_rectification'],
  capabilities: ['entity_crud', 'workflow', 'audit'],
  coverage: { supported: ['设备台账', '点检闭环'], unsupported: [] },
  plugins: [{ id: 'inspection_rectification', config: {} }],
  modules: [{
    id: 'assets', name: '设备台账', route: 'assets', entity: 'asset',
    actions: ['list', 'create', 'update', 'view']
  }],
  entities: [{
    id: 'asset', name: '设备', retention: 'protected', history: false,
    fields: [
      { id: 'code', name: '设备编码', type: 'text', required: true, unique: true },
      { id: 'status', name: '状态', type: 'enum', required: true, options: ['active', 'inactive'] }
    ],
    relations: []
  }],
  roles: [{ id: 'admin', name: '管理员', permissions: ['assets.list', 'assets.create', 'assets.update', 'assets.view'] }],
  workflows: [],
  dashboards: [],
  demoData: { seed: 20260916, entityMinimums: { asset: 20 } },
  materials: {
    developmentPurpose: '形成可追溯的设备点检记录',
    industry: '企业设备管理',
    technicalFeatures: ['离线运行', 'SQLite 持久化']
  }
};
```

- [ ] **Step 2: Run the structural test and verify the module is missing**

Run: `node --test engine/tests/blueprint/structure.test.js`

Expected: FAIL with `Cannot find module '../../blueprint/generated/validate-blueprint-structure.cjs'`.

- [ ] **Step 3: Add the developer package and schema generator**

Create `engine/package.json`:

```json
{
  "name": "rz-project-generator-engine",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "build:blueprint-validator": "node tools/build-blueprint-validator.cjs",
    "test:blueprint": "node --test tests/blueprint/*.test.js"
  },
  "devDependencies": {
    "ajv": "8.17.1"
  }
}
```

Implement `build-blueprint-validator.cjs` with `Ajv2020`, `code: { source: true }`, `allErrors: true`, and `standaloneCode(ajv, validate)`. Write UTF-8 output to `blueprint/generated/validate-blueprint-structure.cjs`, creating the directory if needed. The generated module must export the validator directly.

- [ ] **Step 4: Define schema version 1.0**

Write `blueprint.schema.json` as Draft 2020-12 with `additionalProperties: false` on every object, `$defs` for identifiers, fields, relations, modules, roles, transitions, workflows, dashboards, plugins, and materials, and these required top-level keys:

```json
[
  "schemaVersion", "software", "archetypes", "capabilities", "coverage", "plugins",
  "modules", "entities", "roles", "workflows", "dashboards",
  "demoData", "materials"
]
```

Constrain identifiers with `^[a-z][a-z0-9_]{1,63}$`; define field types as `text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `enum`, or `reference`; define retention as `mutable`, `protected`, or `append_only`; define relation deletion as `restrict`, `cascade`, or `set_null`. Use `uniqueItems: true` for scalar ID arrays. Use `contains` plus `minContains` only where the array itself can enforce a property, and leave cross-object uniqueness to semantic validation.

- [ ] **Step 5: Install, generate, and verify deterministic output**

Run:

```powershell
Set-Location engine
npm install
npm run build:blueprint-validator
$before = (Get-FileHash blueprint/generated/validate-blueprint-structure.cjs).Hash
npm run build:blueprint-validator
$after = (Get-FileHash blueprint/generated/validate-blueprint-structure.cjs).Hash
if ($before -cne $after) { throw 'Standalone validator generation is not deterministic.' }
```

Expected: both hashes match.

- [ ] **Step 6: Run the structural tests**

Run: `node --test engine/tests/blueprint/structure.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit the structural protocol**

```powershell
git add engine/package.json engine/package-lock.json engine/tools/build-blueprint-validator.cjs engine/config/blueprint.schema.json engine/blueprint/generated/validate-blueprint-structure.cjs engine/tests/blueprint/structure.test.js
git commit -m "feat: define blueprint structural protocol"
```

### Task 2: Add Stable Validation Issues and Catalog Loading

**Files:**
- Create: `engine/blueprint/issues.cjs`
- Create: `engine/blueprint/catalog.cjs`
- Create: `engine/config/archetypes.json`
- Create: `engine/config/plugins.json`
- Test: `engine/tests/blueprint/issues.test.js`
- Test: `engine/tests/blueprint/catalog.test.js`

**Interfaces:**
- Produces: `issue(code, path, message, severity = 'error')`.
- Produces: `sortIssues(issues) -> Issue[]` and `summarizeIssues(issues, maxLength = 12000) -> string`.
- Produces: `loadCatalog({ archetypePath, pluginPath } = {}) -> { archetypes: Map, plugins: Map }`.

- [ ] **Step 1: Write failing issue and catalog tests**

Test deterministic sorting by `path`, then `code`, then `message`; summary truncation at the requested maximum; duplicate catalog IDs; an archetype referencing an unknown plugin; and mutation attempts against returned catalog entries.

- [ ] **Step 2: Run tests and verify missing modules**

Run: `node --test engine/tests/blueprint/issues.test.js engine/tests/blueprint/catalog.test.js`

Expected: FAIL with missing `issues.cjs` and `catalog.cjs`.

- [ ] **Step 3: Implement stable issue handling**

Use the exact issue shape:

```js
{ code: 'REFERENCE_ENTITY_UNKNOWN', path: '/modules/0/entity', message: "Unknown entity 'missing'.", severity: 'error' }
```

Reject unknown severities, return frozen issue objects, and make summaries one issue per line in `[CODE] /path: message` format.

- [ ] **Step 4: Add the six archetype and plugin descriptors**

Use these stable IDs:

```text
asset_registry
inspection_rectification
work_order_service
inventory_batch
project_task
application_archive
```

Each archetype entry contains `id`, Chinese `name`, `description`, `allowedPlugins`, and `requiredCapabilities`. Add plugin entries for the same six IDs with `compatibleArchetypes` and `configKeys: { required: [], optional: [] }`; do not add executable code or pretend the future plugin exists. Mark every catalog JSON object with `catalogVersion: "1.0"`.

- [ ] **Step 5: Implement catalog loading and integrity checks**

Resolve default paths relative to `catalog.cjs`, parse with `JSON.parse`, reject duplicate IDs, reject unknown plugin references, deep-freeze returned descriptors, and expose Maps keyed by ID. Error messages must include the source file and offending ID.

- [ ] **Step 6: Run focused tests**

Run: `node --test engine/tests/blueprint/issues.test.js engine/tests/blueprint/catalog.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit catalog support**

```powershell
git add engine/blueprint/issues.cjs engine/blueprint/catalog.cjs engine/config/archetypes.json engine/config/plugins.json engine/tests/blueprint/issues.test.js engine/tests/blueprint/catalog.test.js
git commit -m "feat: add blueprint archetype catalog"
```

### Task 3: Validate Cross-References and Unsupported Coverage

**Files:**
- Create: `engine/blueprint/references.cjs`
- Test: `engine/tests/blueprint/references.test.js`

**Interfaces:**
- Consumes: structurally valid blueprint and catalog Maps.
- Produces: `validateReferences(blueprint, catalog) -> Issue[]`.

- [ ] **Step 1: Write a table-driven failing test**

Cover these exact codes and JSON Pointer paths:

```text
DUPLICATE_ID
ARCHETYPE_UNKNOWN
PLUGIN_UNKNOWN
PLUGIN_INCOMPATIBLE
PLUGIN_CONFIG_MISSING
PLUGIN_CONFIG_UNKNOWN
CAPABILITY_MISSING
REFERENCE_ENTITY_UNKNOWN
REFERENCE_FIELD_UNKNOWN
REFERENCE_MODULE_UNKNOWN
REFERENCE_PERMISSION_UNKNOWN
DASHBOARD_SOURCE_UNKNOWN
UNSUPPORTED_REQUIREMENT
```

Include a passing case where multiple archetypes share one compatible plugin. Require one `UNSUPPORTED_REQUIREMENT` error for each non-empty `coverage.unsupported` entry.

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test engine/tests/blueprint/references.test.js`

Expected: FAIL with missing `references.cjs`.

- [ ] **Step 3: Implement indexed reference validation**

Build Maps once for entities, fields per entity, modules, module action permissions, roles, workflows, and dashboards. Permission keys are exactly `<moduleId>.<action>`. Validate every archetype and plugin against the catalog, every selected archetype's `requiredCapabilities` against `blueprint.capabilities`, plugin required and unknown config keys, every module entity, reference field target, relation target and target field, role permission, workflow entity, and dashboard source.

- [ ] **Step 4: Run focused tests**

Run: `node --test engine/tests/blueprint/references.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit reference validation**

```powershell
git add engine/blueprint/references.cjs engine/tests/blueprint/references.test.js
git commit -m "feat: validate blueprint references"
```

### Task 4: Validate Workflow Reachability and Permissions

**Files:**
- Create: `engine/blueprint/workflows.cjs`
- Test: `engine/tests/blueprint/workflows.test.js`

**Interfaces:**
- Produces: `validateWorkflows(blueprint) -> Issue[]`.

- [ ] **Step 1: Write failing workflow graph tests**

Use a work-order flow `pending -> assigned -> processing -> review -> closed`. Cover duplicate states, missing initial/terminal states, transition endpoints that do not exist, unreachable states, reachable states with no path to a terminal, duplicate transition IDs, transition permissions unknown to all roles, and a passing multi-role flow where dispatcher, engineer, and reviewer collectively complete the path.

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test engine/tests/blueprint/workflows.test.js`

Expected: FAIL with missing `workflows.cjs`.

- [ ] **Step 3: Implement directed graph validation**

For each workflow:

1. Build state and transition indexes.
2. Walk forward from `initialState` and emit `WORKFLOW_STATE_UNREACHABLE` for missing states.
3. Walk backward from all `terminalStates` and emit `WORKFLOW_TERMINAL_UNREACHABLE` for reachable nonterminal states that cannot finish.
4. Verify each transition permission appears in at least one role and emit `WORKFLOW_PERMISSION_UNASSIGNED` otherwise.
5. Verify at least one initial-to-terminal path has every transition assigned to some role; roles may collaborate and no single role is required to own the whole path.

- [ ] **Step 4: Run focused tests**

Run: `node --test engine/tests/blueprint/workflows.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit workflow validation**

```powershell
git add engine/blueprint/workflows.cjs engine/tests/blueprint/workflows.test.js
git commit -m "feat: validate blueprint workflows"
```

### Task 5: Enforce Retention and Deletion Safety

**Files:**
- Create: `engine/blueprint/retention.cjs`
- Test: `engine/tests/blueprint/retention.test.js`

**Interfaces:**
- Produces: `validateRetention(blueprint) -> Issue[]`.

- [ ] **Step 1: Write failing deletion-safety tests**

Cover these rules:

- an `append_only` entity cannot expose `create`, `update`, or `delete` except that `create` is allowed when `systemManaged: true`;
- an entity with `history: true` cannot expose `delete`;
- a required relation cannot use `set_null`;
- a relation from a history entity to its parent must use `restrict`;
- `cascade` cannot target an `append_only` or history entity.

Assert stable codes `RETENTION_ACTION_FORBIDDEN`, `RELATION_DELETE_POLICY_INVALID`, and `HISTORY_DELETE_FORBIDDEN`.

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test engine/tests/blueprint/retention.test.js`

Expected: FAIL with missing `retention.cjs`.

- [ ] **Step 3: Implement minimal retention validation**

Index modules by entity and inspect their actions. Read relation optionality from the source reference field’s `required` property. Do not infer business meaning from Chinese labels; use only explicit blueprint properties.

- [ ] **Step 4: Run focused tests**

Run: `node --test engine/tests/blueprint/retention.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit retention validation**

```powershell
git add engine/blueprint/retention.cjs engine/tests/blueprint/retention.test.js
git commit -m "feat: enforce blueprint retention rules"
```

### Task 6: Compose the Public Validator and Composite Fixture

**Files:**
- Create: `engine/blueprint/validate.cjs`
- Create: `engine/tests/fixtures/blueprints/enterprise-ops.valid.json`
- Create: `engine/tests/fixtures/blueprints/unsupported.invalid.json`
- Test: `engine/tests/blueprint/validate.test.js`

**Interfaces:**
- Produces: `validateBlueprint(value, options = {}) -> ValidationResult`.
- `ValidationResult` is `{ valid, canGenerate, schemaVersion, issues, summary }`.

- [ ] **Step 1: Write failing composition tests**

Require these behaviors:

- malformed input returns structural issues only and never calls semantic validators;
- structurally and semantically valid input returns `valid: true`, `canGenerate: true`;
- unsupported coverage returns `valid: true`, `canGenerate: false` with error issues;
- issue order and summary are deterministic across repeated runs;
- input objects are not mutated.

- [ ] **Step 2: Add a Demo-scale composite fixture**

Create `enterprise-ops.valid.json` with `asset_registry`, `inspection_rectification`, and `work_order_service`; at least eight modules; entities for users, services, assets, alerts, tickets, ticket events, inspections, inspection items, and audit; dispatcher, engineer, reviewer, and administrator roles; ticket and inspection workflows; dashboard metrics; and deterministic demo-data minimums. It is a protocol acceptance fixture, not a generated application.

- [ ] **Step 3: Run the test and verify failure**

Run: `node --test engine/tests/blueprint/validate.test.js`

Expected: FAIL with missing `validate.cjs`.

- [ ] **Step 4: Implement validation composition**

Call the standalone structural validator first. Convert Ajv `instancePath`, `keyword`, and message into `SCHEMA_<KEYWORD>` issues. If structural validation passes, load the catalog once and concatenate reference, workflow, and retention issues. Set:

```js
valid = structuralIssues.length === 0;
canGenerate = valid && semanticIssues.every((entry) => entry.severity !== 'error');
```

Return a deeply frozen result without changing the input.

- [ ] **Step 5: Run the complete Node blueprint suite**

Run: `npm --prefix engine run test:blueprint`

Expected: all blueprint tests PASS.

- [ ] **Step 6: Commit the public validator**

```powershell
git add engine/blueprint/validate.cjs engine/tests/fixtures/blueprints engine/tests/blueprint/validate.test.js
git commit -m "feat: compose blueprint validation"
```

### Task 7: Add CLI and PowerShell Bridge

**Files:**
- Create: `engine/blueprint/cli.cjs`
- Create: `engine/lib/BlueprintValidation.psm1`
- Create: `engine/tests/BlueprintValidation.Tests.ps1`
- Test: `engine/tests/blueprint/cli.test.js`

**Interfaces:**
- CLI: `node engine/blueprint/cli.cjs --input <absolute-json-path>`.
- CLI stdout: one UTF-8 JSON `ValidationResult`; stderr contains only invocation/read failures.
- CLI exit codes: `0` can generate, `1` valid JSON but cannot generate, `2` invocation/file/JSON parse failure.
- PowerShell: `Test-BusinessBlueprint -BlueprintPath <absolute path> -NodePath <absolute path> [-ProcessInvoker <scriptblock>] -> PSCustomObject`. `ProcessInvoker` is a test seam; normal callers omit it.

- [ ] **Step 1: Write failing CLI tests**

Spawn the CLI for the valid fixture, unsupported fixture, malformed JSON, missing file, relative input path, and an extra argument. Assert exit codes, parse stdout for exits `0` and `1`, and require exit `2` messages to omit file contents.

- [ ] **Step 2: Run the CLI tests and verify failure**

Run: `node --test engine/tests/blueprint/cli.test.js`

Expected: FAIL with missing `cli.cjs`.

- [ ] **Step 3: Implement the CLI**

Parse exactly `--input <path>`, require an absolute regular file path, cap input at 5 MiB before reading, parse UTF-8 JSON, call `validateBlueprint`, and emit `JSON.stringify(result)`. Do not echo blueprint contents in errors.

- [ ] **Step 4: Write the failing PowerShell bridge test**

Test valid and unsupported fixtures, a missing absolute path, a relative path, a fake Node executable, and a child process returning malformed stdout. Inject a `ProcessInvoker` scriptblock for process-failure and malformed-output cases instead of creating executable test files. Require the bridge to return `Passed`, `CanGenerate`, `Issues`, `Summary`, and `ExitCode`.

- [ ] **Step 5: Implement the PowerShell bridge**

Validate absolute paths before starting Node. The default `ProcessInvoker` invokes the CLI with `Start-Process` and temporary stdout/stderr files under `$env:TEMP`; the injected form receives `NodePath`, `CliPath`, `BlueprintPath`, `StdoutPath`, and `StderrPath` and returns an integer exit code. Parse stdout with `ConvertFrom-Json`, delete temporary files in `finally`, and reject unexpected exit codes or malformed result shapes. Do not include blueprint contents in thrown messages.

- [ ] **Step 6: Run CLI and bridge tests**

Run:

```powershell
node --test engine/tests/blueprint/cli.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/BlueprintValidation.Tests.ps1
```

Expected: both commands exit `0`.

- [ ] **Step 7: Commit integration interfaces**

```powershell
git add engine/blueprint/cli.cjs engine/lib/BlueprintValidation.psm1 engine/tests/blueprint/cli.test.js engine/tests/BlueprintValidation.Tests.ps1
git commit -m "feat: expose blueprint validation interfaces"
```

### Task 8: Document, Verify, and Freeze the Protocol Sub-project

**Files:**
- Modify: `README.txt`
- Modify only if discovery fails: `engine/tests/Run-All.ps1`

**Interfaces:**
- Documents: schema build, Node test, direct CLI validation, and full-suite commands.
- Verifies: all existing generator behavior remains green.

- [ ] **Step 1: Add developer commands to README**

Append a “业务蓝图开发检查” section documenting:

```powershell
npm --prefix engine ci
npm --prefix engine run build:blueprint-validator
npm --prefix engine run test:blueprint
node engine/blueprint/cli.cjs --input <绝对路径到蓝图.json>
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

State that `npm` is needed only to rebuild the checked-in standalone validator, not to validate blueprints in normal generator operation.

- [ ] **Step 2: Verify generated validator freshness**

Run the build twice and assert the checked-in file has no diff:

```powershell
npm --prefix engine ci
npm --prefix engine run build:blueprint-validator
git diff --exit-code -- engine/blueprint/generated/validate-blueprint-structure.cjs
```

Expected: exit `0` and no diff.

- [ ] **Step 3: Run the complete verification suite**

Run:

```powershell
npm --prefix engine run test:blueprint
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

Expected: both commands exit `0`. The PowerShell suite output may be quiet; the exit code is authoritative.

- [ ] **Step 4: Confirm only intended files changed**

Run:

```powershell
git status --short
git diff --check
git diff --stat HEAD
```

Expected: only README changes remain after prior task commits; no whitespace errors and no generated workspaces, logs, `node_modules`, or delivery artifacts are tracked.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.txt
git commit -m "docs: document blueprint validation workflow"
```

- [ ] **Step 6: Record final evidence**

Run:

```powershell
git status --short --branch
git log --oneline -8
node engine/blueprint/cli.cjs --input (Resolve-Path engine/tests/fixtures/blueprints/enterprise-ops.valid.json)
```

Expected: clean branch; the fixture result reports `valid: true`, `canGenerate: true`, and an empty issue list.
