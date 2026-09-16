# Desktop Business Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable Electron desktop runtime that consumes a validated blueprint and provides SQLite persistence, authentication, permissions, audit, workflows, metadata-driven React pages, backup/restore, end-to-end tests, and a Windows installer.

**Architecture:** Add `engine/desktop-runtime` as a new, isolated package without replacing the current four-page generator template. Keep database, authorization, workflow, and file access in the Electron main process; expose only typed, validated operations through a narrow preload bridge; render fixed professional business UI patterns from blueprint metadata in React. Use a plugin registry boundary but implement only the generic runtime in this plan.

**Tech Stack:** Electron 44.4.1 (Node 24.21.0), React 19.3.0, TypeScript 7.0.2, Vite 8.3.0, `node:sqlite`, Zod 4.6.5, Lucide React 1.46.0, Node test runner with tsx 4.23.13, Playwright 1.63.0, electron-builder 26.15.3 and NSIS.

**Spec:** `docs/superpowers/specs/2026-09-16-desktop-business-runtime-design.md`

## Global Constraints

- Work directly on `feature/next-update`; the user explicitly declined a worktree.
- Add the runtime under `engine/desktop-runtime`; do not replace or modify `engine/template` in this sub-project.
- Pin every package to the exact version listed above and commit `package-lock.json`.
- Target Windows 10/11 x64 and per-user installation.
- The generated application must run offline without Node development tools, a dev server, a system browser, or `node_modules` outside packaged resources.
- Use only `node:sqlite`; do not add native SQLite addons.
- Renderer windows use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and no unrestricted navigation or new windows.
- The renderer never receives SQL, filesystem primitives, password hashes, stack traces, or arbitrary IPC invocation.
- Blueprint conditions/actions remain a fixed whitelist; never use `eval`, `Function`, dynamic scripts, or blueprint-provided SQL.
- Every write, workflow transition, export, backup, and restore is authorized in the main process.
- Existing `npm --prefix engine run test:blueprint` and `engine/tests/Run-All.ps1` must remain green.
- Each task follows red-green-refactor and ends in a focused commit.
- Unless a command includes `--prefix` or a repository-root path, run it from `engine/desktop-runtime`.

---

## File Map

**Package and build**

- Create `engine/desktop-runtime/package.json`: exact dependencies and scripts.
- Create `engine/desktop-runtime/package-lock.json`: reproducible dependency graph.
- Create `engine/desktop-runtime/tsconfig.json`: strict shared/main/preload compilation.
- Create `engine/desktop-runtime/tsconfig.renderer.json`: React compilation contract.
- Create `engine/desktop-runtime/vite.config.ts`: renderer build only.
- Create `engine/desktop-runtime/electron-builder.yml`: Windows x64 NSIS package.
- Create `engine/desktop-runtime/index.html`: renderer entry with restrictive CSP.

**Shared contracts**

- Create `src/shared/blueprint.ts`: runtime subset of blueprint types.
- Create `src/shared/errors.ts`: stable error codes and result envelope.
- Create `src/shared/dto.ts`: list, entity, session, workflow, dashboard and maintenance DTOs.
- Create `src/shared/ipc.ts`: exact channel constants and request/response maps.

**Main and preload**

- Create `src/main/window-options.ts`: testable secure BrowserWindow options.
- Create `src/main/window.ts`: window creation, navigation and external URL denial.
- Create `src/main/index.ts`: Electron lifecycle and service composition.
- Create `src/main/ipc-handlers.ts`: validated IPC registration.
- Create `src/preload/index.ts`: narrow `window.businessApi` context bridge.
- Create `src/preload/global.d.ts`: renderer global API typing.

**Core**

- Create `src/core/blueprint-loader.ts`: compatibility and digest validation.
- Create `src/core/schema-compiler.ts`: blueprint-to-migration compiler.
- Create `src/core/database.ts`: connection, migration and transaction boundary.
- Create `src/core/entity-repository.ts`: metadata-aware CRUD, filters and optimistic locking.
- Create `src/core/passwords.ts`: scrypt hashing and verification.
- Create `src/core/auth-service.ts`: login rate limiting and session lifecycle.
- Create `src/core/permission-service.ts`: main-process authorization.
- Create `src/core/audit-service.ts`: append-only structured audit writes.
- Create `src/core/workflow-engine.ts`: condition checks and whitelisted transactional actions.
- Create `src/core/backup-service.ts`: backup manifest, integrity validation and rollback-safe restore.
- Create `src/core/plugin-registry.ts`: registered-plugin contract without domain implementations.

**Renderer**

- Create `src/renderer/main.tsx`, `App.tsx` and `styles.css`: app bootstrap and quiet admin shell.
- Create `src/renderer/components/AppShell.tsx`: stable navigation and top bar.
- Create `src/renderer/components/DataTable.tsx`: fixed pagination/filter/action layout.
- Create `src/renderer/components/EntityForm.tsx`: metadata form controls.
- Create `src/renderer/components/EntityDetail.tsx`: details, relationships and timeline.
- Create `src/renderer/components/Dashboard.tsx`: metric and work-list layouts.
- Create `src/renderer/components/WorkflowActions.tsx`: allowed transitions and confirmation.
- Create `src/renderer/components/StatusView.tsx`: loading, empty, denied and failure states.
- Create `src/renderer/screens/LoginScreen.tsx`, `ModuleScreen.tsx`, `MaintenanceScreen.tsx`.

**Fixtures and tests**

- Create `fixtures/runtime-blueprint.json`: plugin-free three-entity, three-role acceptance app.
- Create `fixtures/runtime-seed.json`: deterministic test users and business records.
- Create `tests/unit/*.test.ts`: pure contract, schema, permissions and workflow tests.
- Create `tests/integration/*.test.ts`: temporary SQLite, IPC facade and backup/restore tests.
- Create `tests/e2e/runtime.spec.ts`: Electron user journey.
- Create `playwright.config.ts`: serial Windows Electron tests and artifacts.
- Create `tools/copy-runtime-resources.cjs`: deterministic build-resource copy.
- Create `tools/verify-package.cjs`: packaged-resource and executable smoke verification.

---

### Task 1: Scaffold the Package and Lock Secure Window Defaults

**Files:**
- Create: `engine/desktop-runtime/package.json`
- Create: `engine/desktop-runtime/package-lock.json`
- Create: `engine/desktop-runtime/tsconfig.json`
- Create: `engine/desktop-runtime/tsconfig.renderer.json`
- Create: `engine/desktop-runtime/vite.config.ts`
- Create: `engine/desktop-runtime/src/main/window-options.ts`
- Test: `engine/desktop-runtime/tests/unit/window-options.test.ts`

**Interfaces:**
- Produces: `buildWindowOptions(preloadPath: string): Electron.BrowserWindowConstructorOptions`.
- Produces scripts: `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `build`, `dist:win`.

- [ ] **Step 1: Create package metadata and install exact dependencies**

Use this dependency set with no caret or tilde ranges:

```json
{
  "dependencies": {
    "lucide-react": "1.46.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@types/node": "24.13.5",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "electron": "44.4.1",
    "electron-builder": "26.15.3",
    "tsx": "4.23.13",
    "typescript": "7.0.2",
    "vite": "8.3.0"
  }
}
```

Set `main` to `dist/runtime/main/index.js`. Add scripts using `node --import tsx --test` for TypeScript tests, `tsc -p tsconfig.json`, `vite build`, and `electron-builder --win nsis --x64`.

Run: `npm install` from `engine/desktop-runtime`.

Expected: lockfile created and `npm ls --depth=0` reports exactly pinned top-level versions.

- [ ] **Step 2: Write the failing window-security test**

```ts
test('creates an isolated sandboxed renderer without Node access', () => {
  const options = buildWindowOptions('C:\\app\\preload.js');
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(options.webPreferences?.preload, 'C:\\app\\preload.js');
});
```

- [ ] **Step 3: Run the test and verify red**

Run: `node --import tsx --test tests/unit/window-options.test.ts`

Expected: FAIL because `window-options.ts` does not exist.

- [ ] **Step 4: Implement secure fixed options**

Return width `1366`, height `820`, minimum `1100x760`, hidden-until-ready, `show: false`, and the required web preferences. Do not accept caller overrides for security properties.

- [ ] **Step 5: Add strict TypeScript and renderer configurations**

Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, and `useUnknownInCatchVariables`. Use CommonJS output for main/preload and Vite JSX compilation for renderer.

- [ ] **Step 6: Verify unit test and typecheck**

Run:

```powershell
node --import tsx --test tests/unit/window-options.test.ts
npm run typecheck
```

Expected: both exit `0`.

- [ ] **Step 7: Commit scaffold**

```powershell
git add engine/desktop-runtime
git commit -m "feat: scaffold secure desktop runtime"
```

### Task 2: Define Runtime Contracts, Errors, and Blueprint Compatibility

**Files:**
- Create: `src/shared/blueprint.ts`
- Create: `src/shared/errors.ts`
- Create: `src/shared/dto.ts`
- Create: `src/shared/ipc.ts`
- Create: `src/core/blueprint-loader.ts`
- Create: `src/core/plugin-registry.ts`
- Test: `tests/unit/blueprint-loader.test.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Produces: `loadRuntimeBlueprint(input: unknown, expectedSha256: string, plugins: PluginRegistry): RuntimeBlueprint`.
- Produces: `AppErrorCode`, `AppError`, `Result<T>`, `ok(data)` and `fail(error)`.
- Produces: `PluginRegistry.register(descriptor)` and `PluginRegistry.assertCompatible(selections)`.

- [ ] **Step 1: Write failing error-envelope tests**

Require JSON-safe results:

```ts
assert.deepEqual(ok({ id: 1 }), { ok: true, data: { id: 1 } });
assert.deepEqual(fail(new AppError('VERSION_CONFLICT', '记录已被更新')), {
  ok: false,
  error: { code: 'VERSION_CONFLICT', message: '记录已被更新', retryable: true }
});
```

Assert stack, cause, SQL and password fields never appear in serialized output.

- [ ] **Step 2: Write failing blueprint-loader tests**

Cover supported schema `1.0`, digest mismatch, unknown plugin, incompatible plugin version, executable-looking keys such as `script`/`sql`, and input mutation. Use literal SHA-256 expectations computed from fixture bytes, not from the loader under test.

- [ ] **Step 3: Run tests and verify red**

Run: `node --import tsx --test tests/unit/errors.test.ts tests/unit/blueprint-loader.test.ts`

Expected: FAIL because contracts and loader are missing.

- [ ] **Step 4: Implement stable shared contracts**

Define error codes for `VALIDATION_FAILED`, `UNAUTHENTICATED`, `PERMISSION_DENIED`, `NOT_FOUND`, `UNIQUE_CONFLICT`, `VERSION_CONFLICT`, `INVALID_TRANSITION`, `IMPORT_FAILED`, `BACKUP_FAILED`, `RESTORE_FAILED`, `BLUEPRINT_INCOMPATIBLE`, `DATABASE_MIGRATION_FAILED`, and `INTERNAL_ERROR`.

- [ ] **Step 5: Implement compatibility loader and plugin registry**

Deep-clone and deep-freeze accepted blueprints. Verify SHA-256 over canonical fixture bytes supplied by the caller, schema version `1.0`, and exact plugin registrations. Reject keys named `script`, `sql`, `code`, or `expression` anywhere in blueprint data.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
node --import tsx --test tests/unit/errors.test.ts tests/unit/blueprint-loader.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit contracts**

```powershell
git add engine/desktop-runtime/src/shared engine/desktop-runtime/src/core/blueprint-loader.ts engine/desktop-runtime/src/core/plugin-registry.ts engine/desktop-runtime/tests/unit
git commit -m "feat: add desktop runtime contracts"
```

### Task 3: Compile Blueprint Entities into Deterministic Migrations

**Files:**
- Create: `src/core/schema-compiler.ts`
- Test: `tests/unit/schema-compiler.test.ts`

**Interfaces:**
- Produces: `compileSchema(blueprint: RuntimeBlueprint): CompiledSchema`.
- `CompiledSchema` contains `{ version, digest, migrations, entityTables, systemTables }`.
- Each migration is `{ version: number, name: string, statements: readonly string[] }`.

- [ ] **Step 1: Write failing mapping tests**

Use a literal three-entity blueprint and assert exact mappings:

```text
text/reference/enum -> TEXT
integer/boolean -> INTEGER
decimal -> REAL
date/datetime -> TEXT
entity asset -> biz_asset
system audit -> sys_audit_event
```

Assert primary IDs, `version`, created/updated timestamps, unique constraints, foreign keys, delete policies and indexes. Assert two compilations are byte-for-byte identical.

- [ ] **Step 2: Add identifier-injection and unsupported-default tests**

Reject identifiers containing quotes, spaces or SQL punctuation even if an upstream caller bypasses blueprint validation. Reject defaults whose JSON type cannot map to the declared field type.

- [ ] **Step 3: Run tests and verify red**

Run: `node --import tsx --test tests/unit/schema-compiler.test.ts`

Expected: FAIL because compiler is missing.

- [ ] **Step 4: Implement deterministic compiler**

Sort entities only where order is semantically irrelevant; preserve migration dependency order for foreign keys. Quote validated identifiers with double quotes in one dedicated helper. Generate system tables for migration, users, sessions, workflow events, audit events, metadata and backup manifests.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
node --import tsx --test tests/unit/schema-compiler.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit schema compiler**

```powershell
git add engine/desktop-runtime/src/core/schema-compiler.ts engine/desktop-runtime/tests/unit/schema-compiler.test.ts
git commit -m "feat: compile blueprint database schema"
```

### Task 4: Add SQLite Connections, Migrations, and Transaction Boundaries

**Files:**
- Create: `src/core/database.ts`
- Test: `tests/integration/database.test.ts`

**Interfaces:**
- Produces: `openDatabase(options: DatabaseOptions): RuntimeDatabase`.
- Produces methods: `migrate(schema)`, `transaction(fn)`, `prepare(sql)`, `integrityCheck()`, and `close()`.

- [ ] **Step 1: Write failing temporary-database tests**

Use one new temp directory per test. Verify `PRAGMA foreign_keys = ON`, migrations apply once, application with newer DB version is refused, failed migrations roll back, and `transaction()` rolls back all writes when its callback throws.

- [ ] **Step 2: Add a Node/Electron SQLite compatibility probe**

Run the same migration test once with system Node and once through `electron --run-as-node`. Assert both support `DatabaseSync`, prepared parameters, foreign keys, `BEGIN IMMEDIATE`, backup primitives used by Task 8, and `PRAGMA integrity_check`.

- [ ] **Step 3: Run tests and verify red**

Run: `node --import tsx --test tests/integration/database.test.ts`

Expected: FAIL because database module is missing.

- [ ] **Step 4: Implement database wrapper**

Keep raw database access inside this module. Set busy timeout, enable foreign keys, wrap migration errors as `DATABASE_MIGRATION_FAILED`, and always close handles in test cleanup and application shutdown.

- [ ] **Step 5: Run focused integration tests**

Run: `node --import tsx --test tests/integration/database.test.ts`

Expected: pass under Node and Electron run-as-node.

- [ ] **Step 6: Commit database core**

```powershell
git add engine/desktop-runtime/src/core/database.ts engine/desktop-runtime/tests/integration/database.test.ts
git commit -m "feat: add SQLite runtime database"
```

### Task 5: Implement Metadata-Aware Entity Queries and Optimistic Writes

**Files:**
- Create: `src/core/entity-repository.ts`
- Test: `tests/integration/entity-repository.test.ts`

**Interfaces:**
- Produces: `EntityRepository.list(entityId, query, actor)`.
- Produces: `get(entityId, id, actor)`, `create(entityId, values, actor)`, `update(entityId, id, expectedVersion, values, actor)`.
- `ListQuery` supports page, pageSize, sort, keyword and typed filters only.

- [ ] **Step 1: Write failing list behavior tests**

Seed at least 30 records. Assert stable pagination, allowlisted sort columns, escaped keyword search, `eq/ne/gt/gte/lt/lte/in` filters, total count from the same filter set, and page size capped at 100.

- [ ] **Step 2: Write failing write tests**

Assert required fields, enum values, references, unique conflicts, unknown fields, successful create, successful versioned update, and stale version returning `VERSION_CONFLICT` without changing data.

- [ ] **Step 3: Run tests and verify red**

Run: `node --import tsx --test tests/integration/entity-repository.test.ts`

Expected: FAIL because repository is missing.

- [ ] **Step 4: Implement parameterized metadata-aware SQL**

Only table/column identifiers from compiled metadata may enter SQL text. Every user value uses prepared parameters. Return DTOs without internal password or session columns.

- [ ] **Step 5: Run focused tests**

Run: `node --import tsx --test tests/integration/entity-repository.test.ts`

Expected: pass.

- [ ] **Step 6: Commit entity repository**

```powershell
git add engine/desktop-runtime/src/core/entity-repository.ts engine/desktop-runtime/tests/integration/entity-repository.test.ts
git commit -m "feat: add metadata entity repository"
```

### Task 6: Add Authentication, Permission Enforcement, and Append-Only Audit

**Files:**
- Create: `src/core/passwords.ts`
- Create: `src/core/auth-service.ts`
- Create: `src/core/permission-service.ts`
- Create: `src/core/audit-service.ts`
- Test: `tests/unit/passwords.test.ts`
- Test: `tests/integration/auth-permission-audit.test.ts`

**Interfaces:**
- Produces: `hashPassword(password) -> Promise<PasswordDigest>` and `verifyPassword(password, digest)`.
- Produces: `AuthService.login`, `logout`, `requireSession`.
- Produces: `PermissionService.require(actor, permission)`.
- Produces: `AuditService.append(transaction, event)` with no update/delete API.

- [ ] **Step 1: Write failing password tests**

Assert random salts produce different digests, correct passwords verify, incorrect passwords fail, malformed stored digests fail closed, and no function returns plaintext or logs input passwords.

- [ ] **Step 2: Write failing integration tests**

Cover successful login, disabled user, repeated failure lockout, session expiry, logout, missing permission, allowed permission, audit append, audit redaction and absence of update/delete methods.

- [ ] **Step 3: Run tests and verify red**

Run:

```powershell
node --import tsx --test tests/unit/passwords.test.ts
node --import tsx --test tests/integration/auth-permission-audit.test.ts
```

Expected: fail because services are missing.

- [ ] **Step 4: Implement scrypt and bounded sessions**

Use Node crypto random salt and scrypt with explicit parameters stored beside the digest. Store only a hash of session tokens. Apply a bounded login-attempt window and clear successful-user failures.

- [ ] **Step 5: Implement authorization and audit**

Resolve permissions from immutable session role snapshots or current role metadata according to one documented policy; use current role metadata so disabled permissions take effect on the next call. Redact password, token, digest, SQL and filesystem path keys recursively before audit serialization.

- [ ] **Step 6: Run focused tests**

Run both commands from Step 3 and `npm run typecheck`.

Expected: pass.

- [ ] **Step 7: Commit security services**

```powershell
git add engine/desktop-runtime/src/core/passwords.ts engine/desktop-runtime/src/core/auth-service.ts engine/desktop-runtime/src/core/permission-service.ts engine/desktop-runtime/src/core/audit-service.ts engine/desktop-runtime/tests
git commit -m "feat: add runtime authentication and audit"
```

### Task 7: Execute Whitelisted Workflows Atomically

**Files:**
- Create: `src/core/workflow-engine.ts`
- Test: `tests/unit/workflow-conditions.test.ts`
- Test: `tests/integration/workflow-engine.test.ts`

**Interfaces:**
- Produces: `WorkflowEngine.allowedActions(entityId, recordId, actor)`.
- Produces: `execute({ workflowId, transitionId, recordId, expectedVersion, actor, input })`.

- [ ] **Step 1: Write failing condition tests**

Cover `required_field`, `field_equals`, and `relation_exists` with positive and negative literal records. Assert unknown condition/action types fail closed even if TypeScript is bypassed at runtime.

- [ ] **Step 2: Write failing transaction tests**

Cover permission denial, wrong current state, stale version, failed condition, `set_field`, `create_record`, `update_related`, `append_event`, `write_audit`, and rollback when the final action fails. Assert successful transition updates record, event and audit in one commit.

- [ ] **Step 3: Run tests and verify red**

Run:

```powershell
node --import tsx --test tests/unit/workflow-conditions.test.ts
node --import tsx --test tests/integration/workflow-engine.test.ts
```

Expected: fail because workflow engine is missing.

- [ ] **Step 4: Implement condition and action registries**

Use explicit Maps keyed by the five action and three condition IDs. Each handler receives typed context and transaction; no dynamic imports or evaluated expressions.

- [ ] **Step 5: Implement atomic execution**

Re-read state/version within `BEGIN IMMEDIATE`, authorize, execute conditions and actions, append event and audit, then commit. Map expected business failures to stable `AppError` codes and rethrow unexpected failures as redacted `INTERNAL_ERROR`.

- [ ] **Step 6: Run focused and complete core tests**

Run workflow tests, all unit tests and all integration tests.

Expected: pass.

- [ ] **Step 7: Commit workflow engine**

```powershell
git add engine/desktop-runtime/src/core/workflow-engine.ts engine/desktop-runtime/tests
git commit -m "feat: add transactional workflow engine"
```

### Task 8: Add Manifested Backup and Rollback-Safe Restore

**Files:**
- Create: `src/core/backup-service.ts`
- Test: `tests/integration/backup-service.test.ts`

**Interfaces:**
- Produces: `createBackup(destinationDirectory, actor): BackupManifest`.
- Produces: `inspectBackup(databasePath, manifestPath): BackupInspection`.
- Produces: `restoreBackup(inspection, confirmation, actor): RestoreResult`.

- [ ] **Step 1: Write failing backup tests**

Assert a consistent independent SQLite file, SHA-256 manifest, app ID/version/schema version, no overwrite, authorization and audit. Mutate the live DB after backup and confirm backup retains the earlier snapshot.

- [ ] **Step 2: Write failing restore tests**

Cover wrong app ID, future schema, digest mismatch, missing confirmation, successful restore, integrity failure, reopen failure and preservation/restoration of the pre-restore database on every failure path.

- [ ] **Step 3: Run tests and verify red**

Run: `node --import tsx --test tests/integration/backup-service.test.ts`

Expected: fail because backup service is missing.

- [ ] **Step 4: Implement backup and inspection**

Use SQLite backup support proven in Task 4. Write manifest through a temporary file then atomic rename. Never include password hashes or database contents in logs.

- [ ] **Step 5: Implement restore state machine**

Close active handles, move current DB to a uniquely named protection file, copy backup to a temporary target, atomically rename, reopen and run integrity/migration checks. On any failure, close handles, restore the protection file and verify it reopens before returning `RESTORE_FAILED`.

- [ ] **Step 6: Run focused tests**

Run: `node --import tsx --test tests/integration/backup-service.test.ts`

Expected: pass.

- [ ] **Step 7: Commit backup/restore**

```powershell
git add engine/desktop-runtime/src/core/backup-service.ts engine/desktop-runtime/tests/integration/backup-service.test.ts
git commit -m "feat: add runtime backup and restore"
```

### Task 9: Expose a Narrow Validated IPC and Preload API

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/main/ipc-handlers.ts`
- Create: `src/preload/index.ts`
- Create: `src/preload/global.d.ts`
- Test: `tests/unit/ipc-contract.test.ts`
- Test: `tests/integration/ipc-handlers.test.ts`

**Interfaces:**
- Produces exact channels under `business:<area>:<operation>`.
- Produces `registerIpcHandlers(ipc, services)` with injected interfaces for tests.
- Exposes `window.businessApi` methods, never a generic channel method.

- [ ] **Step 1: Write failing contract tests**

Assert the exposed API contains only documented methods and no `invoke`, `send`, filesystem, shell, database or SQL escape hatch. Assert all request schemas reject unknown properties and oversized pagination/import metadata.

- [ ] **Step 2: Write failing handler tests**

Use a real IPC facade test double that invokes registered handlers. Assert session lookup, entity list/get/create/update, workflow actions/execute, dashboard reads, backup/restore inspection and structured error conversion. Verify actor comes from session service, never renderer payload.

- [ ] **Step 3: Run tests and verify red**

Run:

```powershell
node --import tsx --test tests/unit/ipc-contract.test.ts
node --import tsx --test tests/integration/ipc-handlers.test.ts
```

Expected: fail because IPC modules are missing.

- [ ] **Step 4: Implement Zod request parsing and handlers**

Define one schema per operation with `.strict()`. Convert expected `AppError` objects to `Result` and log only redacted unexpected diagnostics with a correlation ID.

- [ ] **Step 5: Implement context bridge**

Expose one method per channel. Freeze the API object. Do not pass Electron events, ports or callbacks into the renderer.

- [ ] **Step 6: Run focused tests and typecheck**

Run both focused suites and `npm run typecheck`.

Expected: pass.

- [ ] **Step 7: Commit IPC boundary**

```powershell
git add engine/desktop-runtime/src/shared engine/desktop-runtime/src/main/ipc-handlers.ts engine/desktop-runtime/src/preload engine/desktop-runtime/tests
git commit -m "feat: add validated desktop IPC bridge"
```

### Task 10: Build the Metadata-Driven React Interface

**Files:**
- Create: `index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`
- Create: renderer components and screens listed in File Map.
- Create: `tests/e2e/ui-contract.spec.ts`

**Interfaces:**
- Consumes only `window.businessApi` and shared DTOs.
- Produces stable routes: `/login`, `/dashboard`, `/module/:moduleId`, `/maintenance`.

- [ ] **Step 1: Add Vite entry and restrictive CSP**

Allow only local bundled scripts/styles/images; deny object, frame and network connections. Development relaxation may be selected only by an explicit development build flag and must not ship in production output.

- [ ] **Step 2: Write failing Playwright UI contract**

Against a temporary test host, require a navigation landmark, software name, current user area, main content, loading state, empty state, denied state, list toolbar, fixed pagination area and responsive 1100x760 layout. Assert no horizontal document overflow.

- [ ] **Step 3: Run test and verify red**

Run: `npm run test:e2e -- tests/e2e/ui-contract.spec.ts`

Expected: fail because renderer is missing.

- [ ] **Step 4: Implement app shell and state views**

Use Lucide icons for commands and navigation. Keep cards at 8px radius or less, stable toolbar heights, no nested cards, no decorative gradients/orbs and no viewport-scaled typography.

- [ ] **Step 5: Implement metadata list, form and detail**

Render only the supported field types. Use controls appropriate to field semantics. Keep workflow actions in a fixed action region; confirmation dialogs name the action and affected record.

- [ ] **Step 6: Implement dashboard and maintenance screens**

Use real IPC data. Do not display feature explanations or developer instructions in the application UI.

- [ ] **Step 7: Run Vite build, typecheck and UI test**

Run:

```powershell
npm run typecheck
npm run build:renderer
npm run test:e2e -- tests/e2e/ui-contract.spec.ts
```

Expected: pass.

- [ ] **Step 8: Commit renderer**

```powershell
git add engine/desktop-runtime/index.html engine/desktop-runtime/src/renderer engine/desktop-runtime/tests/e2e/ui-contract.spec.ts engine/desktop-runtime/vite.config.ts
git commit -m "feat: add metadata-driven desktop UI"
```

### Task 11: Compose the Electron Application and Acceptance Fixture

**Files:**
- Create: `src/main/window.ts`
- Create: `src/main/index.ts`
- Create: `fixtures/runtime-blueprint.json`
- Create: `fixtures/runtime-seed.json`
- Create: `tools/copy-runtime-resources.cjs`
- Create: `playwright.config.ts`
- Create: `tests/e2e/runtime.spec.ts`

**Interfaces:**
- Acceptance app has entities `asset`, `task`, `task_event`; roles `dispatcher`, `operator`, `reviewer`; workflow `pending -> assigned -> processing -> review -> closed`.
- Test-only bootstrap credentials are fixture-scoped and never production defaults.

- [ ] **Step 1: Add a plugin-free validated acceptance blueprint**

Include at least three related entities, three roles, five states, 30 deterministic records, dashboard metrics and no selected domain plugins. Validate it using the completed blueprint CLI before runtime tests.

- [ ] **Step 2: Write failing Electron journey**

Launch Electron with isolated `userData`. Log in as dispatcher, assign a task; log in as operator, accept and resolve it; log in as reviewer, close it. Assert denied operations, timeline entries, audit records and persistence after application restart.

- [ ] **Step 3: Run journey and verify red**

Run: `npm run test:e2e -- tests/e2e/runtime.spec.ts`

Expected: fail because Electron composition is missing.

- [ ] **Step 4: Implement secure window and lifecycle**

Register handlers before loading renderer. Deny unexpected navigation/new windows, show only after `ready-to-show`, dispose database on quit, and route startup failures to a local static recovery page.

- [ ] **Step 5: Implement deterministic resource copy and seed**

Copy blueprint and seed into build resources with SHA-256 manifest. Seed only an empty new database and store scrypt digests, not fixture plaintext.

- [ ] **Step 6: Run full Electron E2E and screenshots**

Run at 1366x768 and 1100x760. Capture login, dashboard, list, detail and workflow views. Assert screenshots are nonblank and text/control regions do not overlap.

- [ ] **Step 7: Commit composed runtime**

```powershell
git add engine/desktop-runtime/src/main engine/desktop-runtime/fixtures engine/desktop-runtime/tools engine/desktop-runtime/playwright.config.ts engine/desktop-runtime/tests/e2e
git commit -m "feat: compose desktop runtime acceptance app"
```

### Task 12: Package and Smoke-Test the Windows Installer

**Files:**
- Create: `electron-builder.yml`
- Create: `tools/verify-package.cjs`
- Test: `tests/integration/package-contract.test.ts`

**Interfaces:**
- Produces: Windows x64 NSIS installer in `dist/installers`.
- Verifies packaged app without requiring source tree or external Node.

- [ ] **Step 1: Write failing package contract test**

Assert app ID, product name, per-user NSIS, selectable installation directory, optional desktop shortcut, ASAR enabled, user data preserved on uninstall, and only required build resources included. Test parsed configuration behavior, not source-line presence.

- [ ] **Step 2: Run test and verify red**

Run: `node --import tsx --test tests/integration/package-contract.test.ts`

Expected: fail because builder config is missing.

- [ ] **Step 3: Implement builder configuration and package verifier**

Configure x64 only, exact artifact name, `asar: true`, no signing claim, and `npmRebuild: false` because no native addon is used. Verify packaged resources, executable startup with isolated user data, no dev-server URL and no dependency on source `node_modules`.

- [ ] **Step 4: Build unpacked app and run smoke test**

Run:

```powershell
npm run build
npx electron-builder --win dir --x64
node tools/verify-package.cjs --unpacked dist/win-unpacked
```

Expected: all exit `0`.

- [ ] **Step 5: Build NSIS installer**

Run: `npm run dist:win`

Expected: one installer in `dist/installers`, no update metadata or unrelated targets.

- [ ] **Step 6: Verify install/start/persist/uninstall lifecycle**

Install per-user into an isolated test directory, start with isolated user data, create one record, restart and verify it remains, then uninstall and verify user data remains. Clean only explicitly resolved test directories.

- [ ] **Step 7: Commit packaging**

```powershell
git add engine/desktop-runtime/electron-builder.yml engine/desktop-runtime/tools/verify-package.cjs engine/desktop-runtime/tests/integration/package-contract.test.ts
git commit -m "feat: package desktop runtime for Windows"
```

### Task 13: Document and Run the Complete Regression Gate

**Files:**
- Create: `engine/desktop-runtime/README.md`
- Modify: root `README.txt`
- Modify: root `.gitignore` only if desktop build artifacts are not already covered.

**Interfaces:**
- Documents exact install, test, build, E2E and package commands.
- Leaves existing generator behavior unchanged.

- [ ] **Step 1: Document runtime development and security boundary**

Document exact commands, user data location, fixture credentials as test-only, blueprint resource contract, backup/restore behavior and the rule that renderer code never accesses Node or SQLite directly.

- [ ] **Step 2: Confirm ignored artifacts**

Verify `engine/desktop-runtime/node_modules`, `dist`, Playwright reports, test results, temp databases, backups and installer outputs are ignored. Add narrow runtime-specific rules only when needed.

- [ ] **Step 3: Run complete desktop verification**

Run:

```powershell
npm --prefix engine/desktop-runtime ci
npm --prefix engine/desktop-runtime run typecheck
npm --prefix engine/desktop-runtime run test:unit
npm --prefix engine/desktop-runtime run test:integration
npm --prefix engine/desktop-runtime run build
npm --prefix engine/desktop-runtime run test:e2e
```

Expected: all exit `0`.

- [ ] **Step 4: Run existing generator regression**

Run:

```powershell
npm --prefix engine run test:blueprint
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

Expected: blueprint tests and full PowerShell suite exit `0`.

- [ ] **Step 5: Run final package verification**

Run Windows installer build and `verify-package.cjs`; record installer path, size, app version and smoke-test exit code.

- [ ] **Step 6: Check repository hygiene**

Run:

```powershell
git status --short
git diff --check
git ls-files engine/desktop-runtime | rg "node_modules|(^|/)dist/|test-results|playwright-report|\\.sqlite$"
```

Expected: only documentation changes remain; artifact search returns no tracked build output.

- [ ] **Step 7: Commit documentation**

```powershell
git add engine/desktop-runtime/README.md README.txt .gitignore
git commit -m "docs: document desktop runtime workflow"
```

- [ ] **Step 8: Record completion evidence**

Run `git status --short --branch`, `git log --oneline -15`, all final test commands and the packaged executable verification. Do not claim this sub-project complete without fresh output from each command.
