# Domain Pack Protocol and Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the versioned domain-pack protocol, safe catalog loader, capability dependency resolver, ownership-aware fragment merger, deterministic blueprint composer, lockfile generator, CLI, and PowerShell bridge used by all six future domain packs.

**Architecture:** Add an independent TypeScript package at `engine/domain-packs`. Packs are data plus registered entrypoints: the composer loads validated catalogs/fragments from explicit paths, resolves an acyclic capability graph, applies ownership and declared extension rules, emits a complete blueprint, validates it through the existing blueprint validator, and writes canonical JSON outputs. This plan creates only protocol fixtures, not the six production domain implementations.

**Tech Stack:** Node.js 22+, TypeScript 7.0.2, tsx 4.23.13, Zod 4.6.5, Node test runner, existing CommonJS blueprint validator and PowerShell 5.1 bridge.

**Spec:** `docs/superpowers/specs/2026-09-17-domain-archetype-plugins-design.md`

## Global Constraints

- Work directly on `feature/next-update`; the user previously declined a worktree.
- Create only `engine/domain-packs`; do not modify the six production blueprint fragments in this plan.
- Pin exact dependency versions and commit `package-lock.json`.
- Pack discovery is explicit; never scan arbitrary user directories or execute unregistered code.
- Reject symlinks/reparse points, path escapes, unknown properties, scripts, SQL and dynamic expressions.
- All IDs are lower snake case and all versions are exact semantic versions.
- Dependencies form a directed acyclic graph and must be listed in `allowedDependencies`.
- Each owned object has one owner; extensions require a public extension point.
- Conflicts fail with stable issue codes and JSON Pointer paths; no last-write-wins behavior.
- Identical inputs produce byte-identical blueprint, lockfile and report JSON.
- Composed blueprints must pass the existing structural and semantic blueprint validator.
- Existing blueprint, desktop runtime and PowerShell suites remain green.
- Every production behavior follows red-green-refactor and each task ends with a focused commit.

---

## File Map

**Package and contracts**

- Create `engine/domain-packs/package.json`, `package-lock.json`, `tsconfig.json`.
- Create `src/shared/types.ts`: catalog, fragment, selection, ownership, extension, result and lock types.
- Create `src/shared/errors.ts`: stable composition issue codes and deterministic formatting.
- Create `src/shared/canonical-json.ts`: recursively sorted canonical JSON writer.
- Create `src/protocol/schemas.ts`: strict Zod catalog, fragment and request schemas.

**Loading and composition**

- Create `src/catalog/load-pack.ts`: regular-file and reparse-safe pack loading with SHA-256.
- Create `src/catalog/registry.ts`: explicit pack registry and duplicate checks.
- Create `src/composition/dependencies.ts`: capability provider resolution, allowed edges, cycles and stable topological order.
- Create `src/composition/ownership.ts`: object owner and public extension-point indexes.
- Create `src/composition/merge.ts`: strict blueprint-fragment merge operations.
- Create `src/composition/compose.ts`: end-to-end composition and existing-validator gate.
- Create `src/composition/lockfile.ts`: deterministic `domain-lock.json` model.

**Interfaces and tests**

- Create `src/cli.ts`: file request to blueprint/lock/report output directory.
- Create `engine/lib/DomainPackComposition.psm1`: PowerShell 5.1 invocation bridge.
- Create `tests/fixtures/packs/*`: minimal valid providers, consumers and focused invalid packs.
- Create `tests/unit/*.test.ts`: protocol, loader, dependencies, ownership, merge and canonical tests.
- Create `tests/integration/compose.test.ts`: complete valid and invalid composition tests.
- Create `tests/integration/cli.test.ts`: process exit/output/security tests.
- Create `engine/tests/DomainPackComposition.Tests.ps1`: generator bridge tests discovered by existing `Run-All.ps1`.
- Create `engine/domain-packs/README.md`: developer commands and protocol boundary.

---

### Task 1: Scaffold the Package, Stable Issues, and Canonical JSON

**Files:**
- Create: `engine/domain-packs/package.json`
- Create: `engine/domain-packs/package-lock.json`
- Create: `engine/domain-packs/tsconfig.json`
- Create: `src/shared/types.ts`
- Create: `src/shared/errors.ts`
- Create: `src/shared/canonical-json.ts`
- Test: `tests/unit/errors-canonical.test.ts`

**Interfaces:**
- Produces: `CompositionIssue`, `CompositionIssueCode`, `issue()`, `sortIssues()`, `summarizeIssues()`.
- Produces: `canonicalJson(value): string` with trailing newline.
- Produces core types `PackCatalog`, `PackFragment`, `PackSelection`, `CompositionResult`, `DomainLock`.

- [ ] **Step 1: Add exact package metadata**

Use exact dependencies:

```json
{
  "dependencies": { "zod": "4.6.5" },
  "devDependencies": {
    "@types/node": "24.13.5",
    "tsx": "4.23.13",
    "typescript": "7.0.2"
  }
}
```

Scripts: `typecheck`, `test:unit`, `test:integration`, `test`, and `compose`.

- [ ] **Step 2: Write failing issue/canonical tests**

Assert stable issue shape:

```ts
{
  code: 'PACK_CATALOG_INVALID',
  packId: 'asset_registry',
  path: '/version',
  message: 'Version is invalid.',
  severity: 'error'
}
```

Assert sorting by `packId`, path, code and message without input mutation. Assert canonical JSON recursively sorts object keys, preserves array order, escapes Unicode through normal JSON rules, rejects unsupported values such as `undefined`, functions, bigint and cycles, and ends with one newline.

- [ ] **Step 3: Run tests and verify red**

Run: `node --import tsx --test tests/unit/errors-canonical.test.ts`

Expected: FAIL because modules are missing.

- [ ] **Step 4: Implement minimal contracts and utilities**

Issue codes include all codes from design section 11. Freeze issues and returned arrays. Canonical JSON accepts JSON values only and detects cycles before serialization.

- [ ] **Step 5: Run tests and typecheck**

Run:

```powershell
node --import tsx --test tests/unit/errors-canonical.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit scaffold**

```powershell
git add engine/domain-packs
git commit -m "feat: scaffold domain pack protocol"
```

### Task 2: Define Strict Catalog and Fragment Schemas

**Files:**
- Create: `src/protocol/schemas.ts`
- Test: `tests/unit/protocol.test.ts`

**Interfaces:**
- Produces: `packCatalogSchema`, `packFragmentSchema`, `compositionRequestSchema`.
- Produces: `parseCatalog`, `parseFragment`, `parseCompositionRequest` returning frozen typed data.

- [ ] **Step 1: Write failing protocol tests**

Cover a complete valid catalog and fragment, unknown properties, invalid IDs, non-exact versions, duplicate capabilities, unsafe entry paths, executable keys, missing ownership, invalid extension operations and malformed selection config.

Use this catalog shape:

```json
{
  "catalogVersion": "1.0",
  "id": "inspection_rectification",
  "version": "1.0.0",
  "name": "巡检与整改",
  "description": "巡检任务和异常整改闭环",
  "blueprintSchemaVersions": ["1.0"],
  "runtimeVersions": ["1.0.0"],
  "provides": ["inspection.core"],
  "requires": ["asset.core"],
  "allowedDependencies": ["asset_registry", "work_order_service"],
  "migrationsVersion": 1,
  "entrypoints": {
    "fragment": "blueprint.json",
    "runtime": "runtime/index.js",
    "ui": "ui/index.js",
    "seed": "seed/index.json",
    "tests": "tests/index.js"
  },
  "uiSlots": ["entity.detail.tabs"]
}
```

- [ ] **Step 2: Run test and verify red**

Run: `node --import tsx --test tests/unit/protocol.test.ts`

Expected: FAIL because schemas are missing.

- [ ] **Step 3: Implement strict schemas**

Use `.strict()` for every object. Entry paths must be normalized relative paths without drive, root, `..`, empty segments or backslashes. Fragment extension operations are only `append`, `merge_display`, `extend_enum`, and `add_transition`.

- [ ] **Step 4: Reject executable material recursively**

After Zod parsing, recursively reject keys named `script`, `sql`, `code`, `expression`, `command`, or `executable` except the business field ID value `"code"`, which is a value and remains valid.

- [ ] **Step 5: Run test and typecheck**

Expected: pass.

- [ ] **Step 6: Commit protocol schemas**

```powershell
git add engine/domain-packs/src/protocol engine/domain-packs/tests/unit/protocol.test.ts
git commit -m "feat: define domain pack schemas"
```

### Task 3: Load Packs Safely and Build an Explicit Registry

**Files:**
- Create: `src/catalog/load-pack.ts`
- Create: `src/catalog/registry.ts`
- Create: `tests/fixtures/packs/asset-provider/catalog.json`
- Create: `tests/fixtures/packs/asset-provider/blueprint.json`
- Test: `tests/unit/catalog-loader.test.ts`

**Interfaces:**
- Produces: `loadPack(packRoot: string): LoadedPack`.
- `LoadedPack` includes frozen catalog, fragment, normalized root and SHA-256 content digest.
- Produces: `PackRegistry.register(pack)` and exact `get(id, version)`.

- [ ] **Step 1: Write failing real-filesystem tests**

Cover valid load, relative root rejection, missing catalog/fragment, path escape entry, directory where file expected, reparse point/symlink, catalog/fragment ID/version mismatch, duplicate registry key and registry lookup by wrong version.

- [ ] **Step 2: Run test and verify red**

Run: `node --import tsx --test tests/unit/catalog-loader.test.ts`

Expected: FAIL because loader is missing.

- [ ] **Step 3: Implement safe loading**

Require absolute pack root. Resolve every entry under that root, reject reparse points for root, directories and files, cap each JSON file at 5 MiB, parse UTF-8, and compute digest over canonical catalog + newline + canonical fragment.

- [ ] **Step 4: Implement explicit registry**

Registry has no scan method. Callers register `LoadedPack` objects explicitly. Duplicate `(id, version)` rejects; same ID with another exact version may coexist.

- [ ] **Step 5: Run focused tests and typecheck**

Expected: pass.

- [ ] **Step 6: Commit loader**

```powershell
git add engine/domain-packs/src/catalog engine/domain-packs/tests
git commit -m "feat: load domain packs safely"
```

### Task 4: Resolve Capabilities and Stable Dependency Order

**Files:**
- Create: `src/composition/dependencies.ts`
- Test: `tests/unit/dependencies.test.ts`
- Create focused fixture packs under `tests/fixtures/packs`.

**Interfaces:**
- Produces: `resolveDependencies(selections, registry): ResolvedPackGraph`.
- `ResolvedPackGraph` includes `orderedPacks`, `capabilityProviders`, and dependency edges.

- [ ] **Step 1: Write failing dependency tests**

Cover one provider, missing provider, two selected providers for one required capability, forbidden dependency, explicit version mismatch, self-dependency, two/three-node cycles and deterministic topological order independent of selection input order.

- [ ] **Step 2: Run test and verify red**

Run: `node --import tsx --test tests/unit/dependencies.test.ts`

Expected: FAIL because resolver is missing.

- [ ] **Step 3: Implement provider resolution**

Resolve only among selected exact package versions. A required capability must have exactly one provider unless the catalog declares it optional. Emit `CAPABILITY_MISSING` or `CAPABILITY_AMBIGUOUS` with pack and requirement paths.

- [ ] **Step 4: Implement stable topological sort**

Use Kahn's algorithm with lexicographically sorted ready IDs. On remaining nodes, compute and report one stable cycle path with `DEPENDENCY_CYCLE`.

- [ ] **Step 5: Run tests and typecheck**

Expected: pass.

- [ ] **Step 6: Commit dependency resolution**

```powershell
git add engine/domain-packs/src/composition/dependencies.ts engine/domain-packs/tests
git commit -m "feat: resolve domain pack dependencies"
```

### Task 5: Enforce Ownership and Merge Declared Extensions

**Files:**
- Create: `src/composition/ownership.ts`
- Create: `src/composition/merge.ts`
- Test: `tests/unit/ownership-merge.test.ts`

**Interfaces:**
- Produces: `buildOwnershipIndex(orderedPacks): OwnershipIndex`.
- Produces: `mergeFragments(orderedPacks, ownership): MergedBlueprintParts`.

- [ ] **Step 1: Write failing ownership tests**

Cover duplicate object owner, duplicate route, extension of missing target, extension of private target, owner extending itself through the wrong path and stable owner lookup for entities/modules/workflows/roles.

- [ ] **Step 2: Write failing merge-operation tests**

Cover:

- `append` to a declared list extension point;
- `merge_display` changing only name/description/order;
- `extend_enum` adding unique options without changing field type;
- `add_transition` at a declared workflow extension point;
- conflicting field type/required/unique/delete policy;
- duplicate state, transition, permission and seed unique key;
- UI slot conflicts.

- [ ] **Step 3: Run tests and verify red**

Run: `node --import tsx --test tests/unit/ownership-merge.test.ts`

Expected: FAIL because ownership/merge modules are missing.

- [ ] **Step 4: Implement immutable merge**

Never modify loaded fragments. Clone target structures, apply only declared operations, track source pack for every added value and return sorted issues instead of partially successful output.

- [ ] **Step 5: Run tests and typecheck**

Expected: pass.

- [ ] **Step 6: Commit ownership merge**

```powershell
git add engine/domain-packs/src/composition/ownership.ts engine/domain-packs/src/composition/merge.ts engine/domain-packs/tests/unit/ownership-merge.test.ts
git commit -m "feat: merge owned domain fragments"
```

### Task 6: Compose and Validate Complete Blueprints and Lockfiles

**Files:**
- Create: `src/composition/lockfile.ts`
- Create: `src/composition/compose.ts`
- Create: `src/blueprint-validator.ts`
- Test: `tests/integration/compose.test.ts`

**Interfaces:**
- Produces: `composeDomainPacks(request, registry): CompositionResult`.
- `CompositionResult` contains frozen `blueprint`, `lock`, `report`, `issues`, `valid`, `canGenerate`.

- [ ] **Step 1: Write failing valid composition test**

Use minimal `asset_registry` provider and `inspection_rectification` consumer fixtures. Assert complete blueprint, exact stable order, SHA-256 digests, lock dependency order, report ownership and byte-identical canonical output across reversed selection order.

- [ ] **Step 2: Write failing invalid-result tests**

Cover dependency issue short-circuit, merge conflict, composed blueprint rejected by existing validator, unsupported requirements preserved, and no blueprint/lock output when generation is blocked.

- [ ] **Step 3: Run test and verify red**

Run: `node --import tsx --test tests/integration/compose.test.ts`

Expected: FAIL because composer is missing.

- [ ] **Step 4: Add a typed wrapper around the existing validator**

Import `engine/blueprint/validate.cjs` through one wrapper, validate result shape at runtime and convert existing validator issues to composer report entries without changing their code/path/message.

- [ ] **Step 5: Implement end-to-end composition**

Parse request, resolve graph, build ownership, merge, construct top-level software/coverage/demo/material fields, run existing validator, then produce a lock only if `canGenerate` is true. Lock records exact pack version, pack digest, fragment digest, blueprint/runtime compatibility, migration version, dependency order and UI entry digest.

- [ ] **Step 6: Run all unit/integration tests and typecheck**

Expected: pass.

- [ ] **Step 7: Commit composer**

```powershell
git add engine/domain-packs/src engine/domain-packs/tests/integration/compose.test.ts
git commit -m "feat: compose validated domain blueprints"
```

### Task 7: Add CLI, PowerShell Bridge, Documentation, and Full Regression

**Files:**
- Create: `src/cli.ts`
- Create: `tests/integration/cli.test.ts`
- Create: `engine/lib/DomainPackComposition.psm1`
- Create: `engine/tests/DomainPackComposition.Tests.ps1`
- Create: `engine/domain-packs/README.md`
- Modify: root `README.txt`

**Interfaces:**
- CLI: `node dist/cli.js --request <absolute-json> --output <absolute-empty-directory>`.
- Exit codes: `0` composed, `1` valid request but blocked, `2` invocation/read/write failure.
- Output on success: `blueprint.json`, `domain-lock.json`, `composition-report.json` written atomically.
- PowerShell: `Invoke-DomainPackComposition -RequestPath -OutputPath -NodePath`.

- [ ] **Step 1: Write failing CLI tests**

Cover success, blocked composition, malformed JSON, relative path, nonempty output, path escape, input >5 MiB, output atomicity and no source/secret echo in stderr.

- [ ] **Step 2: Implement CLI with atomic directory publish**

Write to a sibling staging directory, fsync/close files, then rename to the requested absent/empty target. On any failure remove staging and leave target absent or empty.

- [ ] **Step 3: Write failing PowerShell bridge tests**

Use injected process invoker for malformed stdout and unexpected exit. Require absolute regular request, absolute Node and safe output directory. Return `Passed`, `CanGenerate`, `Issues`, `Summary`, `OutputPath`, `ExitCode`.

- [ ] **Step 4: Implement PowerShell 5.1 bridge**

Use ASCII source, temporary stdout/stderr files, `finally` cleanup and no blueprint contents in errors. Export only `Invoke-DomainPackComposition`.

- [ ] **Step 5: Add documentation**

Document package protocol, exact commands, explicit registration, no-code fragments, lockfile behavior, fixture-only status and the fact that production domain packs are later tasks.

- [ ] **Step 6: Run domain package verification**

```powershell
npm --prefix engine/domain-packs ci
npm --prefix engine/domain-packs run typecheck
npm --prefix engine/domain-packs test
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/DomainPackComposition.Tests.ps1
```

Expected: all pass.

- [ ] **Step 7: Run existing regression suites**

```powershell
npm --prefix engine run test:blueprint
npm --prefix engine/desktop-runtime run typecheck
npm --prefix engine/desktop-runtime run test:unit
npm --prefix engine/desktop-runtime run test:integration
powershell -NoProfile -ExecutionPolicy Bypass -File engine/tests/Run-All.ps1
```

Expected: all pass.

- [ ] **Step 8: Check repository hygiene**

Assert no `node_modules`, dist output, temp directories, composed fixture output, SQLite, EXE or logs are tracked. Run `git diff --check` and secret-pattern scans.

- [ ] **Step 9: Commit documentation**

```powershell
git add engine/domain-packs/README.md README.txt engine/lib/DomainPackComposition.psm1 engine/tests/DomainPackComposition.Tests.ps1
git commit -m "docs: document domain pack composition"
```

- [ ] **Step 10: Record completion evidence**

Run fresh full verification, `git status --short --branch`, `git log --oneline -12`, and a valid fixture CLI composition. Do not claim the unit complete without all outputs.
