# Asset Registry Domain Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the production `asset_registry` domain pack with a complete validated blueprint fragment, tested asset lifecycle service, extension contracts, deterministic seed generation, single-pack composition acceptance and documentation.

**Architecture:** Implement the pack under `engine/domain-packs/packs/asset_registry`. The blueprint owns category, asset, responsibility and append-only asset-event entities plus navigation, roles, workflow and dashboard. A narrow runtime service performs asset lifecycle transitions in a caller-provided SQLite transaction and accepts registered blocker checks from future work-order/inspection packs; it cannot open its own database or bypass base permissions/audit.

**Tech Stack:** Existing domain-pack protocol/composer, desktop-runtime TypeScript/SQLite contracts, TypeScript 7, Node test runner with tsx, `node:sqlite` integration tests.

**Spec:** `docs/superpowers/specs/2026-09-17-domain-archetype-plugins-design.md` section 8.1.

## Global Constraints

- Pack ID/version: `asset_registry@1.0.0`.
- Blueprint/runtime compatibility: blueprint `1.0`, runtime `1.0.0`.
- Provide `asset.core`; require no other domain capability.
- Asset, category and responsibility codes are unique and stable.
- Asset events are append-only and system-managed.
- Status changes always increment version, append an event and append audit in one transaction.
- Allowed status values: `active`, `maintenance`, `inactive`.
- Allowed transitions: active→maintenance, maintenance→active, active→inactive, maintenance→inactive, inactive→active.
- Transition to inactive fails when any registered blocker reports an unfinished related record.
- Assets with history cannot be hard-deleted.
- Runtime service receives a transaction/actor/permission gate/audit sink; it never opens SQLite itself.
- Seed output is deterministic for a numeric seed and contains no real company/person identity.
- Existing composer, blueprint, desktop-runtime and PowerShell tests remain green.

---

### Task 1: Create and Validate the Production Pack

**Files:**
- Create `engine/domain-packs/packs/asset_registry/catalog.json`
- Create `.../blueprint.json`
- Create placeholder entry files under `runtime`, `ui`, `seed`, `tests`
- Test `engine/domain-packs/tests/integration/asset-registry-pack.test.ts`

**Interfaces:**
- Catalog provides `asset.core` and publishes asset detail tabs/actions extension points.
- Fragment owns `asset_category`, `asset`, `asset_responsibility`, `asset_event`; modules and `asset_lifecycle` workflow; roles `asset_admin` and `asset_viewer`.

- [ ] Write a failing test that loads the real pack, composes it alone, and passes the existing blueprint validator.
- [ ] Assert at least four modules, four entities, one workflow, two roles, dashboard metrics, append-only event retention and explicit extension points.
- [ ] Run the test and confirm missing pack failure.
- [ ] Add strict catalog and full blueprint fragment with no scripts/SQL.
- [ ] Run loader/composer acceptance and typecheck.
- [ ] Commit: `feat: add asset registry blueprint pack`.

### Task 2: Implement Atomic Asset Lifecycle Transitions

**Files:**
- Create `packs/asset_registry/runtime/index.ts`
- Create `src/shared/runtime-plugin.ts` only if a common transaction/plugin interface is required.
- Test `tests/integration/asset-lifecycle.test.ts`

**Interfaces:**
- `AssetLifecycleService.changeStatus(request, context): AssetLifecycleResult`.
- `request`: asset ID, expected version, next status, reason.
- `context`: actor, SQLite transaction, permission gate, audit sink, blocker registry, clock.
- Blocker: `(assetId, transaction) -> { blocked, code, message }`.

- [ ] Write failing tests for every allowed transition.
- [ ] Write failing tests for wrong state, stale version, missing permission, unknown asset and inactive blocker.
- [ ] Write a rollback test where event/audit write fails after asset update.
- [ ] Implement explicit transition map, permission `assets.change_status`, blocker checks only for inactive, versioned update, event and audit writes.
- [ ] Run focused tests and typecheck.
- [ ] Commit: `feat: add asset lifecycle service`.

### Task 3: Enforce History and Responsibility Rules

**Files:**
- Extend `runtime/index.ts`
- Test `tests/integration/asset-rules.test.ts`

**Interfaces:**
- `AssetLifecycleService.assertCanDelete(assetId, context): void`.
- `AssetLifecycleService.assignResponsibility(request, context): result`.

- [ ] Write failing tests: no-history deletion allowed, event/responsibility history blocks deletion, duplicate active responsibility rejected, end old responsibility then assign new in one transaction, stale version rollback.
- [ ] Implement without delete SQL; `assertCanDelete` is a guard consumed by later entity delete service.
- [ ] Responsibility changes append asset event and audit.
- [ ] Run tests/typecheck and commit `feat: enforce asset history rules`.

### Task 4: Add Deterministic Seed Generation

**Files:**
- Create `packs/asset_registry/seed/index.ts`
- Test `tests/unit/asset-seed.test.ts`

**Interfaces:**
- `generateAssetSeed({ seed, categoryCount, assetCount }): AssetSeed`.

- [ ] Write failing tests for byte-stable same seed, different output for another seed, exact counts, valid unique codes, valid category/responsibility references and no applicant/company identity.
- [ ] Implement a small deterministic PRNG; do not use `Math.random`, current time or locale order.
- [ ] Emit categories, assets, responsibilities and initial events consistent with the fragment.
- [ ] Run tests/typecheck and commit `feat: add deterministic asset seed`.

### Task 5: Register UI Extensions and Pack Acceptance Scenario

**Files:**
- Create `packs/asset_registry/ui/index.ts`
- Create `packs/asset_registry/tests/index.ts`
- Test `tests/integration/asset-pack-acceptance.test.ts`

**Interfaces:**
- UI descriptors register only `entity.detail.tabs` and `entity.detail.actions`.
- Acceptance scenario creates category/assets, changes responsibility/status, verifies dashboard counts, event history and audit.

- [ ] Write failing descriptor test ensuring no login/nav/maintenance replacement and no direct IPC/database functions.
- [ ] Write failing real-SQLite acceptance scenario using composed blueprint and desktop-runtime schema/database services.
- [ ] Implement descriptors for “责任关系” and “状态历史” tabs plus status action group.
- [ ] Implement scenario runner with injected services.
- [ ] Run unit/integration/type checks and commit `feat: complete asset pack acceptance`.

### Task 6: Document and Run Full Regression

**Files:**
- Create `packs/asset_registry/README.md`
- Modify `engine/domain-packs/README.md`

- [ ] Document entities, transitions, permissions, blocker extension, seed parameters, limits and test commands.
- [ ] Run domain pack `npm ci`, typecheck, unit, integration and self-contained CLI build.
- [ ] Compose production asset pack through bundle CLI and verify blueprint/lock/report.
- [ ] Run blueprint 55 tests, desktop 19 unit + 26 integration tests and PowerShell `Run-All.ps1`.
- [ ] Check no node_modules/dist/temp/SQLite/EXE/log artifacts tracked and run secret scan.
- [ ] Commit `docs: document asset registry pack`.
- [ ] Record fresh completion evidence and push the stable checkpoint.

---

## Review Remediation

The independent completion review found that direct-import tests did not prove runtime plugin loading, and that generic entity writes could bypass asset invariants. The following tasks are required before Task 6 can be considered complete.

### Task 7: Prove Runtime Plugin Loading and Registration

**Files:**
- Modify `engine/desktop-runtime/src/core/plugin-registry.ts`
- Modify `packs/asset_registry/runtime/index.ts`
- Modify `tests/integration/asset-pack-acceptance.test.ts`

**Interfaces:**
- `PluginDescriptor` includes `blueprintSchemaVersions`, `validateConfig` and fixed registration hooks for migrations, services, IPC, UI and acceptance scenarios.
- `assetRuntimeDescriptor` implements that contract for `asset_registry@1.0.0`.
- The acceptance test registers the production descriptor, loads the composed JSON through `loadRuntimeBlueprint`, and captures every declared contribution through restricted registration sinks.

- [ ] Add a failing acceptance assertion that `PluginRegistry.register(assetRuntimeDescriptor)` can load the composed blueprint through `loadRuntimeBlueprint` and validates empty config.
- [ ] Add failing registration assertions for the lifecycle service, UI descriptors and acceptance scenario; unsupported configuration must fail closed.
- [ ] Extend the runtime plugin contract and implement the production asset descriptor without importing Electron or opening a database.
- [ ] Run desktop runtime unit tests, asset acceptance and both type checks.
- [ ] Commit `fix: register asset runtime plugin`.

### Task 8: Prevent Generic CRUD From Bypassing Domain Rules

**Files:**
- Modify `engine/desktop-runtime/src/core/entity-repository.ts`
- Modify `engine/desktop-runtime/tests/integration/entity-repository.test.ts`
- Modify `packs/asset_registry/blueprint.json`
- Modify `tests/integration/asset-rules.test.ts`

**Interfaces:**
- Generic `create` and `update` require both a declared module action and the matching role permission.
- The asset module does not declare generic `update`.
- The responsibility module declares the domain action `assign`, not generic `create` or `end`.

- [ ] Add failing desktop-runtime tests for undeclared create/update actions and missing actor permission.
- [ ] Add failing asset-pack tests proving generic status update and generic responsibility creation return `PERMISSION_DENIED` without changing SQLite.
- [ ] Enforce declared module actions and role permissions in `EntityRepository.create/update`.
- [ ] Remove generic asset/responsibility mutations from the production blueprint and rename responsibility permission to `asset_responsibilities.assign`.
- [ ] Run focused tests, blueprint validation, domain-pack typecheck and desktop-runtime typecheck.
- [ ] Commit `fix: protect asset domain mutations`.

### Task 9: Validate Assignees and Roll Back Late Responsibility Failures

**Files:**
- Modify `packs/asset_registry/runtime/index.ts`
- Modify `tests/integration/asset-rules.test.ts`
- Modify `tests/integration/asset-pack-acceptance.test.ts`
- Modify `packs/asset_registry/README.md`

**Interfaces:**
- `AssetLifecycleContext.assigneeExists(assignee, transaction): boolean` validates a stable user or responsibility-role identifier through a caller-owned registry.
- `assignResponsibility` fails with `VALIDATION_FAILED` before writes when the assignee is unknown.

- [ ] Add a failing invalid-assignee test.
- [ ] Add a failing late-audit rollback test after an existing responsibility would be ended and a replacement inserted.
- [ ] Require the injected assignee lookup and use the domain permission `asset_responsibilities.assign`.
- [ ] Update all test contexts and documentation.
- [ ] Run focused tests and typecheck.
- [ ] Commit `fix: validate asset responsibility assignments`.

### Task 10: Repeat Completion Gate

- [ ] Re-run domain-pack clean install, typecheck, all tests, build and production bundle composition.
- [ ] Re-run blueprint 55 tests, desktop 19 unit + 26 integration tests and PowerShell `Run-All.ps1`.
- [ ] Re-run artifact, diff and secret scans.
- [ ] Request a fresh independent code review over the remediation range and address all Critical/Important findings.
- [ ] Finish Task 6 documentation commit and push the complete stable checkpoint.
