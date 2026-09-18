# 申请与归档领域包实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付生产级 `application_archive@1.0.0`，实现多轮顺序审批、只追加审批记录、应用托管文件版本、可恢复文件导入、申请归档、证照续期和幂等到期提醒。

**Architecture:** 六实体核心包独立运行，由 `ApplicationArchiveService` 暴露固定业务命令，内部拆分审批、文件、证照和查询模块。SQLite 业务事务继续由调用方提供；文件采用 staged→promote→ready 的可恢复最终一致协议，最终审批桥接只通过类型化命令总线参与当前 SQLite 事务。

**Tech Stack:** TypeScript 7、tsx、Node test runner、`node:sqlite`、Node `fs`/`crypto`、现有领域包组合器、蓝图验证器和桌面运行时插件协议。

**Spec:** `docs/superpowers/specs/2026-09-18-application-archive-design.md`

## Global Constraints

- ID/version：`application_archive@1.0.0`；蓝图 `1.0`；运行时 `1.0.0`。
- 提供 `application.core` 和 `archive.core`，不依赖其他生产领域包。
- 只拥有 `application`、`approval_node`、`approval_record`、`file_version`、`certificate`、`expiry_reminder`。
- 六实体禁止通用创建和更新；`approval_record` 为 `append_only + history + systemManaged`。
- `approval_levels` 为 1–3、默认 2；`reminder_days` 为 0–365、默认 30；未知配置失败关闭。
- 旧审批轮次、审批记录、ready 文件内容、旧证照版本和旧提醒不可覆盖。
- 渲染器不得传入任意文件路径，只能使用文件选择器产生的不透明 stage token。
- UI 仅含纯数据；种子固定时钟、无符号 32 位 seed 和匿名身份。

---

### Task 1: 生产蓝图片段与严格配置

**Files:**
- Create: `engine/domain-packs/packs/application_archive/catalog.json`
- Create: `engine/domain-packs/packs/application_archive/blueprint.json`
- Create: `engine/domain-packs/packs/application_archive/runtime/index.ts`
- Create: `engine/domain-packs/packs/application_archive/ui/index.ts`
- Create: `engine/domain-packs/packs/application_archive/seed/index.ts`
- Create: `engine/domain-packs/packs/application_archive/tests/index.ts`
- Test: `engine/domain-packs/tests/integration/application-pack.test.ts`

**Interfaces:**
- Catalog provides `application.core` and `archive.core`.
- Entities/modules: `application/applications`, `approval_node/approval_nodes`, `approval_record/approval_records`, `file_version/file_versions`, `certificate/certificates`, `expiry_reminder/expiry_reminders`.
- Roles: `application_applicant`, `application_reviewer`, `application_compliance_reviewer`, `application_archive_manager`, `application_admin`.

- [ ] **Step 1: Write the failing production-pack test**

```ts
test('loads and composes production application archive pack', () => {
  const pack = loadPack(path.resolve(__dirname, '..', '..', 'packs', 'application_archive'));
  const registry = new PackRegistry(); registry.register(pack);
  const result = composeDomainPacks({
    blueprintSchemaVersion:'1.0', runtimeVersion:'1.0.0',
    software:{ id:'application_app', name:'离线申请归档管理软件', version:'1.0.0',
      purpose:'管理申请审批和文件归档', targetUsers:['申请审批岗位'], boundaries:['离线'], loginMode:'required' },
    selections:[{ id:'application_archive', version:'1.0.0',
      config:{ approval_levels:2, reminder_days:30 } }],
    coverage:{ supported:['申请审批归档'], unsupported:[] },
    materials:{ developmentPurpose:'审批归档', industry:'企业管理', technicalFeatures:['SQLite事务','SHA-256'] }
  }, registry);
  assert.equal(result.canGenerate, true, result.summary);
  const blueprint = result.blueprint as any;
  assert.deepEqual(blueprint.entities.map((x:any) => x.id), [
    'application','approval_node','approval_record','file_version','certificate','expiry_reminder'
  ]);
  assert.equal(blueprint.entities.every((x:any) => x.systemManaged), true);
  assert.equal(blueprint.entities.find((x:any) => x.id === 'approval_record').retention, 'append_only');
});
```

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test tests/integration/application-pack.test.ts` from `engine/domain-packs`.

Expected: FAIL because `packs/application_archive` does not exist.

- [ ] **Step 3: Add strict catalog and fragment**

Declare all fields, relations, five roles and six modules with domain actions only. Initialize `detailTabs: []`/`createSources: []` on application and `detailTabs: []` on certificate. Public extension points must be exactly:

```text
application.fields / relations / detail.tabs / create.sources
file_version.fields / relations
certificate.fields / relations / detail.tabs
```

No module exposes generic `create`, `update` or `delete`.

- [ ] **Step 4: Add minimal frozen entrypoints and verify**

Run: `npm run typecheck && node --import tsx --test tests/integration/application-pack.test.ts && node --test ../tests/blueprint/*.test.js`.

Expected: pack PASS; blueprint 55/55 PASS.

- [ ] **Step 5: Commit**

```powershell
git add engine/domain-packs/packs/application_archive engine/domain-packs/tests/integration/application-pack.test.ts
git commit -m "feat: add application archive blueprint pack"
```

---

### Task 2: 草稿、多轮节点与顺序审批

**Files:**
- Create: `engine/domain-packs/packs/application_archive/runtime/types.ts`
- Create: `engine/domain-packs/packs/application_archive/runtime/internals.ts`
- Create: `engine/domain-packs/packs/application_archive/runtime/application-service.ts`
- Create: `engine/domain-packs/packs/application_archive/runtime/approval-commands.ts`
- Create: `engine/domain-packs/tests/helpers/application-runtime.ts`
- Test: `engine/domain-packs/tests/integration/application-draft.test.ts`
- Test: `engine/domain-packs/tests/integration/application-approval.test.ts`
- Test: `engine/domain-packs/tests/integration/application-resubmit.test.ts`

**Interfaces:**
- `ApplicationContext { connection; actor; config; requirePermission; appendAudit; identityHasRole; approvalCompletionHandlers; commandBus; now; applicationCode; nodeCode; recordCode; fileVersionCode; certificateCode; reminderCode }`
- `createApplication`, `updateDraftApplication`, `submitApplication`, `approveCurrentNode`, `rejectCurrentNode`, `withdrawApplication`, `reviseApplication`.
- `ApplicationConfig { approvalLevels:1|2|3; reminderDays:number }`.

- [ ] **Step 1: Write draft RED tests**

Cover applicant-only create/update, normalized nonempty type/title/content, optimistic versions, strict ownership, generic write denial for all six entities and audit rollback.

```ts
const tx = <T>(run:(connection:DatabaseSync)=>T) => database.transaction(run);
const draft = tx(c => service.createApplication({
  applicationType:'inventory_issue', title:'领用申请', content:'申请领用耗材'
}, context(c, applicant)));
assert.deepEqual({ status:draft.status, round:draft.approvalRound, version:draft.version },
  { status:'draft', round:0, version:1 });
```

- [ ] **Step 2: Implement shared validation and draft commands**

`internals.ts` owns strict reads, identity-before-state checks, conditional updates, approval-record append and frozen results. All values are parameterized. Draft changes never create approval nodes.

- [ ] **Step 3: Write sequential approval RED tests for 1, 2 and 3 levels**

For each level count, submit a draft and assert exact node roles/statuses. Approve nodes in order; wrong role, waiting node, stale node/application version and self-injected actor data fail. Final approval sets application approved and appends records without modifying earlier records.

- [ ] **Step 4: Implement submit and node approval**

`submitApplication` increments round, inserts N nodes, activates sequence 1 and appends `submitted`. `approveCurrentNode` conditionally approves the active node; it activates the next waiting node or completes the application. Node, application, record and audit remain one transaction.

- [ ] **Step 5: Write rejection, withdrawal and resubmission RED tests**

Assert reject/withdraw cancels remaining current-round nodes, revise returns only the owner to draft, update is then allowed, resubmit creates a new round, and every old node/record remains byte-identical. Approved/archived applications cannot revise or withdraw.

- [ ] **Step 6: Implement reject/withdraw/revise and verify**

Run:

```powershell
npm run typecheck
node --import tsx --test tests/integration/application-draft.test.ts tests/integration/application-approval.test.ts tests/integration/application-resubmit.test.ts
```

- [ ] **Step 7: Commit**

```powershell
git add engine/domain-packs/packs/application_archive/runtime engine/domain-packs/tests/helpers/application-runtime.ts engine/domain-packs/tests/integration/application-*.test.ts
git commit -m "feat: add multi-round application approval"
```

---

### Task 3: 最终批准桥接与事务回滚

**Files:**
- Modify: `engine/domain-packs/packs/application_archive/runtime/types.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/approval-commands.ts`
- Test: `engine/domain-packs/tests/integration/application-completion-handler.test.ts`

**Interfaces:**
- `ApplicationApprovedDto` is deeply frozen and contains application ID/code/type/round/applicant, not SQL or mutable objects.
- `DomainCommandBus.invoke(commandId:string, payload:Readonly<Record<string,JsonValue>>): unknown`.
- `ApplicationApprovalCompletionHandler(dto, commandBus): void`.

- [ ] **Step 1: Write handler RED tests**

Register two handlers and assert stable order, frozen DTO, no `connection`/`prepare`/`exec`, exact command-bus payload and invocation only on final approval. Intermediate approve, reject and withdraw do not invoke handlers.

- [ ] **Step 2: Write rollback RED test**

Second handler throws after the first invokes a real test command that inserts a bridge row using the current transaction. Assert final node, application, approval record, bridge row and audit all roll back.

- [ ] **Step 3: Implement the typed completion boundary**

Call handlers after domain conditions and before final conditional updates are committed. The command bus allowlists registered command IDs; unknown IDs return `BLUEPRINT_INCOMPATIBLE`. Do not expose the SQLite connection.

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && node --import tsx --test tests/integration/application-completion-handler.test.ts`.

```powershell
git add engine/domain-packs/packs/application_archive/runtime engine/domain-packs/tests/integration/application-completion-handler.test.ts
git commit -m "feat: add transactional approval completion hooks"
```

---

### Task 4: 托管文件暂存、完成与恢复

**Files:**
- Create: `engine/domain-packs/packs/application_archive/runtime/archive-store.ts`
- Create: `engine/domain-packs/packs/application_archive/runtime/file-commands.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/types.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/application-service.ts`
- Test: `engine/domain-packs/tests/unit/archive-store.test.ts`
- Test: `engine/domain-packs/tests/integration/application-file-version.test.ts`
- Test: `engine/domain-packs/tests/integration/application-file-recovery.test.ts`

**Interfaces:**
- `ManagedArchiveStore(root, stagingRoot)`.
- `stageSelectedFile(sourcePath): { stageToken, originalName, sha256, sizeBytes }` is called only by trusted main-process file-picker code.
- `promote(stageToken, fileVersionCode)`, `inspectStage`, `inspectReady`, `discardStage`.
- Service methods `registerStagedFile`, `finalizeFileVersion`, `recoverStagedFiles`.

- [ ] **Step 1: Write archive-store path/security RED tests**

Use real temporary directories. Cover byte-copy and SHA-256, opaque token format, absolute/`..`/separator rejection, duplicate destination refusal, no overwrite, symlink/reparse rejection at root/source/stage/destination boundaries, and cleanup of failed staging.

- [ ] **Step 2: Implement minimal managed store**

Use `lstat`, resolved-root prefix checks, exclusive file creation and same-volume atomic rename. Stream SHA-256 and size; never trust renderer metadata. Store only relative formal paths.

- [ ] **Step 3: Write staged/ready domain RED tests**

Register application-owned versions with unique `(owner_type, owner_code, business_key, business_version)`. Assert metadata matches staged inspection, only owner or archive manager may register, finalize recomputes digest/size, ready content and metadata cannot update, and audit failure rolls back DB state without overwriting files.

- [ ] **Step 4: Implement file commands and two-phase state**

`registerStagedFile` inserts staged metadata. `finalizeFileVersion` promotes if needed, verifies formal bytes, then conditionally updates staged→ready. On mismatch it updates staged→failed with redacted reason. A ready destination is accepted only when digest and size match the row.

- [ ] **Step 5: Write crash-recovery RED tests**

Cover stage exists/formal absent, stage absent/formal valid, both absent, formal hash mismatch, already ready and repeated recovery. Assert recovery is idempotent and never overwrites a conflicting formal file.

- [ ] **Step 6: Implement recovery and verify**

Run:

```powershell
npm run typecheck
node --import tsx --test tests/unit/archive-store.test.ts tests/integration/application-file-version.test.ts tests/integration/application-file-recovery.test.ts
```

- [ ] **Step 7: Commit**

```powershell
git add engine/domain-packs/packs/application_archive/runtime engine/domain-packs/tests/unit/archive-store.test.ts engine/domain-packs/tests/integration/application-file-*.test.ts
git commit -m "feat: add recoverable managed archive storage"
```

---

### Task 5: 申请归档、证照续期与幂等提醒

**Files:**
- Create: `engine/domain-packs/packs/application_archive/runtime/certificate-commands.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/application-service.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/types.ts`
- Test: `engine/domain-packs/tests/integration/application-archive.test.ts`
- Test: `engine/domain-packs/tests/integration/certificate-lifecycle.test.ts`
- Test: `engine/domain-packs/tests/integration/expiry-reminder.test.ts`

**Interfaces:**
- `archiveApplication({ applicationId, expectedVersion, fileVersionCode, comment }, context)`.
- `createCertificate`, `renewCertificate`.
- `refreshExpiryReminders({ today }, context)`.
- `acknowledgeReminder({ reminderId, expectedVersion }, context)`.

- [ ] **Step 1: Write application-archive RED tests**

Approved application plus ready, application-owned file archives successfully with append-only record/audit. staged/failed/wrong-owner file, non-approved state, wrong role, stale version and late audit failure leave application unchanged. Archived application rejects every application/approval write.

- [ ] **Step 2: Implement archive command**

Read identity before status/version. Update approved→archived, append `archived` record and audit in one transaction; never modify file content.

- [ ] **Step 3: Write certificate/renewal RED tests**

Cover strict dates, `issuedAt <= expiresAt`, optional expiry, ready certificate-owned file, unique business version, valid previous active version, active→superseded and new active insertion in one transaction, old row/file/reminders preserved, and audit rollback.

- [ ] **Step 4: Implement certificate commands**

Certificate version content is immutable. Renewal only changes previous status/version and inserts the new row; it never rewrites old dates or file references.

- [ ] **Step 5: Write reminder boundary/idempotency RED tests**

With injected dates, assert outside-window none, threshold day upcoming, expiry day expired, past expiry expired, no-expiry none, duplicate refresh no duplicate, renewal creates reminders only for the active version, acknowledge is versioned and repeat acknowledge fails.

- [ ] **Step 6: Implement reminders and verify**

Use parameterized queries and a domain-level uniqueness check backed by transaction serialization. Update expired active certificates before reminder insertion. Run the three focused tests plus typecheck.

- [ ] **Step 7: Commit**

```powershell
git add engine/domain-packs/packs/application_archive/runtime engine/domain-packs/tests/integration/application-archive.test.ts engine/domain-packs/tests/integration/certificate-lifecycle.test.ts engine/domain-packs/tests/integration/expiry-reminder.test.ts
git commit -m "feat: add archive certificates and reminders"
```

---

### Task 6: 动态汇总与确定性种子

**Files:**
- Create: `engine/domain-packs/packs/application_archive/runtime/queries.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/application-service.ts`
- Modify: `engine/domain-packs/packs/application_archive/seed/index.ts`
- Test: `engine/domain-packs/tests/integration/application-summary.test.ts`
- Test: `engine/domain-packs/tests/unit/application-seed.test.ts`

**Interfaces:**
- `readApplicationSummary(applicationId, context)`.
- `readApplicationDashboard(context)`.
- `generateApplicationArchiveSeed({ seed, applicationCount, certificateCount })`.
- Bounds: seed `0..0xffffffff`, applications `6..10000`, certificates `2..1000`.

- [ ] **Step 1: Write live-summary RED tests**

Assert status counts, current-role active nodes, approved-not-archived, upcoming/expired active certificates, pending reminders and staged/failed files. Exact date equality is expired. Results must change immediately after SQLite mutations and injected-clock changes.

- [ ] **Step 2: Implement query-only summaries**

Use current SQLite state, actor role and injected clock. No caches and no static dashboard filters for dynamic date values.

- [ ] **Step 3: Write deterministic seed RED tests**

Assert stability, seed sensitivity, bounds, exact counts, unique codes and valid references. Replay every application round/node/record to the final status; verify no planning application has approval nodes, archived applications have ready files, certificate chains and reminder dates are consistent, and anonymous-content scan passes.

- [ ] **Step 4: Implement fixed-time xorshift32 seed**

Cover all six application states, rejected/withdrawn resubmission rounds, all node roles, staged/ready/failed files, certificate renewal and pending/acknowledged reminder records. Generate event times monotonically and derive final state from the emitted chain.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && node --import tsx --test tests/integration/application-summary.test.ts tests/unit/application-seed.test.ts`.

```powershell
git add engine/domain-packs/packs/application_archive/runtime engine/domain-packs/packs/application_archive/seed/index.ts engine/domain-packs/tests/integration/application-summary.test.ts engine/domain-packs/tests/unit/application-seed.test.ts
git commit -m "feat: add application summaries and seed"
```

---

### Task 7: 插件、UI、扩展包与真实端到端验收

**Files:**
- Modify: `engine/domain-packs/packs/application_archive/runtime/index.ts`
- Modify: `engine/domain-packs/packs/application_archive/ui/index.ts`
- Modify: `engine/domain-packs/packs/application_archive/tests/index.ts`
- Create: `engine/domain-packs/tests/unit/application-ui.test.ts`
- Create: `engine/domain-packs/tests/integration/application-pack-acceptance.test.ts`
- Create: `engine/domain-packs/tests/integration/application-extension.test.ts`
- Create: `engine/domain-packs/tests/fixtures/packs/application-domain-bridge/**`

**Interfaces:**
- Service `application.lifecycle`; acceptance `application.lifecycle.acceptance`; migration `application_archive.v1`.
- Plugin config accepts only optional `approval_levels`/`reminder_days`, applies documented defaults and exact ranges.

- [ ] **Step 1: Write exact plugin/UI RED tests**

Assert the full ordered contribution ID list: migration, service, every explicit IPC, all UI extensions and one acceptance scenario. UI IDs must include application node/record/file tabs, certificate version/reminder tabs, application/file/certificate/reminder actions and dashboard. Recursively assert UI has no functions.

- [ ] **Step 2: Implement production descriptor and UI**

Register fixed hooks only. IPC exposes named commands and queries, never arbitrary entity write, SQL, source path or generic file execution.

- [ ] **Step 3: Write real SQLite + filesystem acceptance**

Use production composition/plugin activation, real permissions/audit, real temporary archive roots and exact flow from the spec: first-round rejection, revision, second-round approval, staged→ready file, application archive, certificate creation, reminder refresh/acknowledge and renewal. Assert files, hashes, versions, nodes, records, audits and dashboard.

- [ ] **Step 4: Add complete on-disk bridge fixture**

Fixture provides a domain document capability, requires `application.core` and uses every public application/file/certificate extension point. It registers a test approval completion command through the typed bus and proves handler failure rolls back final approval.

- [ ] **Step 5: Verify focused gates and commit**

Run:

```powershell
npm run typecheck
node --import tsx --test tests/unit/application-*.test.ts tests/integration/application-*.test.ts
node --test ../tests/blueprint/*.test.js
```

```powershell
git add engine/domain-packs/packs/application_archive engine/domain-packs/tests
git commit -m "feat: complete application archive acceptance"
```

---

### Task 8: 文档、独立审查、全量门槛与推送

**Files:**
- Create: `engine/domain-packs/packs/application_archive/README.md`
- Modify: `engine/domain-packs/README.md`

- [ ] **Step 1: Document the exact production boundary**

Record six entities, approval rounds/roles, withdrawal rules, completion handlers, file recovery states, path security, certificate renewal, reminder semantics, configuration/defaults, seed bounds and bridge responsibilities. Explicitly state no external notification, e-signature, OCR or online storage.

- [ ] **Step 2: Run fresh domain gates**

```powershell
npm run typecheck
npm test
npm run build
```

- [ ] **Step 3: Run shared gates sequentially**

```powershell
node --test engine\tests\blueprint\*.test.js
Set-Location engine\desktop-runtime
npm run typecheck
npm run test:unit
npm run test:integration
Set-Location ..\..
powershell -NoProfile -ExecutionPolicy Bypass -File .\engine\tests\Run-All.ps1
```

Do not run PowerShell total tests concurrently with npm processes; Windows environment key casing can make `PATH`/`Path` collide.

- [ ] **Step 4: Build production CLI composition and filesystem package verification**

Compose the real pack using checked-in `bin/domain-pack-cli.cjs`, require exactly three canonical outputs, validate blueprint with `engine/blueprint/cli.cjs`, then run the acceptance file flow in a fresh temp directory and verify no staging residue. Remove all temporary artifacts.

- [ ] **Step 5: Repository hygiene scan**

Run `git diff --check`; scan tracked files for SQLite/DB/log/EXE/temp/staging/askpass artifacts and actual token values. Do not delete existing ignored delivery or dependency artifacts.

- [ ] **Step 6: Independent review and repair**

Review from design through implementation. Required focus: identity-before-state/version, old-round immutability, node role/order, final-handler rollback, command-bus allowlist, stage-token/path/reparse safety, no-overwrite, crash recovery, digest validation, certificate chain atomicity, reminder idempotency/date boundary, exact plugin/UI list and seed event chronology. Fix every Critical/Important with red-green tests, then repeat full gates.

- [ ] **Step 7: Commit and push**

```powershell
git add engine/domain-packs/README.md engine/domain-packs/packs/application_archive/README.md
git commit -m "docs: document application archive pack"
git push origin feature/next-update
```

Confirm a clean worktree and `git rev-list --left-right --count origin/feature/next-update...HEAD` equals `0 0`.
