# Domain Matrix and Reference Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver five production bridge packs, a real production-plugin host, all eight required combination tests, and a packaged asset/work-order/inspection Electron reference application with exactly 1000 deterministic business records.

**Architecture:** Core packs retain ownership of their entities and state machines; bridge packs contribute only explicit relations, blockers, completion handlers, commands, and fixed-slot UI. A bundled production catalog is loaded and verified by the desktop host, which executes allowlisted domain commands inside its current SQLite transaction. The reference application uses the same composer, lock files, host, resources, runtime, and installer path as generated projects.

**Tech Stack:** TypeScript 7, Node.js 24 test runner, Electron 44, React 19, SQLite via `node:sqlite`, Zod 4, Playwright 1.63, esbuild 0.28, electron-builder 26, PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-20-domain-matrix-reference-e2e-design.md`

## Global Constraints

- Keep blueprint schema `1.0`, desktop runtime `1.0.0`, and every first-version core/bridge pack at `1.0.0`.
- Keep the renderer sandboxed: no Node.js, filesystem, SQLite, raw SQL, or arbitrary IPC access.
- Every cross-pack write uses one caller-owned SQLite transaction; no bridge opens a second database connection.
- Core states may be changed only through their owning domain service.
- Runtime command payloads are strict, acyclic JSON with a maximum serialized size of 64 KiB.
- Idempotency is enforced by SQLite unique constraints, not process memory.
- Default reference seed output contains exactly 1000 counted business rows; identities, permissions, audit, and migration rows are excluded.
- The reference application contains the three core packs and three matching bridge packs only.
- Existing legacy generator behavior and all existing domain/runtime tests must remain green.
- Repository output must exclude SQLite databases, logs, screenshots outside test results, installers, plaintext credentials, and access tokens.

---

### Task 1: Shared Typed Domain Command Runtime

**Files:**
- Create: `engine/domain-packs/src/runtime/command-bus.ts`
- Create: `engine/domain-packs/src/runtime/types.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/types.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/command-bus.ts`
- Modify: `engine/domain-packs/packs/domain_document_bridge/runtime/index.ts`
- Create: `engine/domain-packs/tests/unit/domain-command-bus.test.ts`
- Modify: `engine/domain-packs/tests/integration/application-completion-handler.test.ts`

**Interfaces:**
- Produces: `DomainCommandBus.invoke(commandId, payload): JsonValue | void`.
- Produces: `DomainCommandDefinition { id, allowedSources, parse, execute }` and `DomainCommandExecutionContext { connection, actor, sourcePluginId }`.
- Preserves: application approval completion handlers receive the same `DomainCommandBus` interface.

- [ ] **Step 1: Write failing shared-bus tests**

```ts
test('executes only an allowed source with normalized frozen JSON', () => {
  const bus = new AllowlistedDomainCommandBus([definition], context('inventory_application_bridge'));
  assert.deepEqual(bus.invoke('inventory.issue', { quantity: 2 }), { issued: 2 });
  assert.equal(Object.getPrototypeOf(receivedPayload), null);
  assert.equal(Object.isFrozen(receivedPayload), true);
});

test('rejects unknown, oversized, cyclic, accessor and conflicting-source payloads', () => {
  assert.throws(() => bus.invoke('missing', {}), /not registered/);
  assert.throws(() => bus.invoke('inventory.issue', { value: 'x'.repeat(65_537) }), /64 KiB/);
  assert.throws(() => forbiddenBus.invoke('inventory.issue', {}), /not allowed/);
});
```

- [ ] **Step 2: Run the new test and verify the shared module is missing**

Run: `cd engine/domain-packs; node --import tsx --test tests/unit/domain-command-bus.test.ts`

Expected: FAIL with module-not-found for `src/runtime/command-bus`.

- [ ] **Step 3: Implement the shared types and bus**

```ts
export interface DomainCommandExecutionContext {
  readonly connection: DatabaseSync;
  readonly actor: Readonly<{ userId: number; username: string; displayName: string; roleId: string }>;
  readonly sourcePluginId: string;
}

export interface DomainCommandDefinition {
  readonly id: string;
  readonly allowedSources: readonly string[];
  readonly parse: (payload: Readonly<Record<string, JsonValue>>) => Readonly<Record<string, JsonValue>>;
  readonly execute: (context: DomainCommandExecutionContext, payload: Readonly<Record<string, JsonValue>>) => JsonValue | void;
}
```

Implement normalization with property descriptors, null-prototype output, cycle rejection, finite-number checks, symbol/accessor rejection, 64 KiB canonical JSON size enforcement, duplicate command rejection, and source allowlisting.

- [ ] **Step 4: Convert the old application-local bus into a compatibility export**

```ts
export { AllowlistedDomainCommandBus } from '../../../src/runtime/command-bus';
export type { DomainCommandBus } from '../../../src/runtime/types';
```

Update the application and document bridge imports without changing approval behavior.

- [ ] **Step 5: Run focused and full domain tests**

Run: `cd engine/domain-packs; npm run typecheck; node --import tsx --test tests/unit/domain-command-bus.test.ts tests/integration/application-completion-handler.test.ts; npm test`

Expected: all commands exit `0`; the existing rollback and hostile-payload tests remain green.

- [ ] **Step 6: Commit**

```powershell
git add engine/domain-packs/src/runtime engine/domain-packs/packs/application_archive/runtime engine/domain-packs/packs/domain_document_bridge/runtime engine/domain-packs/tests
git commit -m "refactor: share typed domain command runtime"
```

---

### Task 2: Typed Plugin Contributions and Production Catalog Bundle

**Files:**
- Modify: `engine/desktop-runtime/src/core/plugin-registry.ts`
- Create: `engine/desktop-runtime/src/core/plugin-host.ts`
- Create: `engine/domain-packs/src/runtime/production-catalog.ts`
- Create: `engine/domain-packs/tools/build-runtime-catalog.cjs`
- Modify: `engine/domain-packs/package.json`
- Create: `engine/desktop-runtime/tests/unit/plugin-host.test.ts`
- Create: `engine/domain-packs/tests/unit/production-catalog.test.ts`

**Interfaces:**
- Produces: optional descriptor hooks `registerDomainActions`, `registerDomainCommands`, `registerLifecycleBlockers`, and `registerCompletionHandlers`.
- Produces: `PluginHost.freeze(): ActivatedPluginHost` with immutable contribution maps.
- Produces: `productionPluginDescriptors`, containing six core descriptors and six production bridge descriptors once all bridge tasks are complete.
- Produces: `dist/production-runtime-catalog.cjs`, a self-contained catalog bundle.

- [ ] **Step 1: Write failing registry and host tests**

```ts
test('activates selections in locked dependency order and freezes every registry', () => {
  const host = new PluginHost();
  registry.activate(selections, host, ['asset_registry', 'asset_work_order_bridge']);
  const activated = host.freeze();
  assert.deepEqual(activated.activationOrder, ['asset_registry', 'asset_work_order_bridge']);
  assert.throws(() => host.services.register('late', 'late', {}), /frozen/);
});

test('rejects duplicate contribution ids and an unlocked descriptor version', () => {
  assert.throws(() => host.services.register('b', 'asset.lifecycle', {}), /already registered/);
  assert.throws(() => registry.assertLocked(lockWithVersion('asset_registry', '2.0.0')), /version/);
});
```

- [ ] **Step 2: Run tests and verify missing host/catalog failures**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/plugin-host.test.ts`

Run: `cd engine/domain-packs; node --import tsx --test tests/unit/production-catalog.test.ts`

Expected: both fail because the new modules are absent.

- [ ] **Step 3: Add typed optional hooks and immutable host registries**

```ts
export interface RuntimePluginHost {
  readonly migrations: PluginContributionSink;
  readonly services: PluginContributionSink;
  readonly ipc: PluginContributionSink;
  readonly uiExtensions: PluginContributionSink;
  readonly acceptanceScenarios: PluginContributionSink;
  readonly domainActions: PluginContributionSink;
  readonly domainCommands: PluginContributionSink;
  readonly lifecycleBlockers: PluginContributionSink;
  readonly completionHandlers: PluginContributionSink;
}
```

`PluginRegistry.activate` must follow the `domain-lock.json` dependency order, verify descriptor versions and call optional hooks only after the six required hooks.

The host records the owner of every completion handler and blocker. When a handler receives a `DomainCommandBus`, the bus is scoped to that contribution owner as `sourcePluginId`; a handler cannot claim another plugin identity to bypass `allowedSources`.

- [ ] **Step 4: Add the production catalog source and bundle command**

```ts
export const productionPluginDescriptors = Object.freeze([
  assetRuntimeDescriptor,
  workOrderRuntimeDescriptor,
  inspectionRuntimeDescriptor,
  inventoryRuntimeDescriptor,
  projectRuntimeDescriptor,
  applicationRuntimeDescriptor,
  domainDocumentRuntimeDescriptor
]);
```

The initial test expects these seven existing descriptors. Later bridge tasks append their descriptors. The esbuild script bundles for Node CJS, targets Node 22, marks `electron` and `node:*` external, and writes only to the requested output path.

- [ ] **Step 5: Run typechecks, catalog tests, and build the bundle**

Run: `cd engine/domain-packs; npm run typecheck; npm run build:runtime-catalog`

Run: `cd engine/desktop-runtime; npm run typecheck; node --import tsx --test tests/unit/plugin-host.test.ts`

Expected: the CJS bundle exports seven unique descriptors and all commands exit `0`.

- [ ] **Step 6: Commit**

```powershell
git add engine/domain-packs engine/desktop-runtime/src/core engine/desktop-runtime/tests/unit/plugin-host.test.ts
git commit -m "feat: add production plugin host and catalog"
```

---

### Task 3: Executable Core Commands and Runtime Extension Hooks

**Files:**
- Create: `engine/domain-packs/src/runtime/action-types.ts`
- Create: `engine/domain-packs/packs/asset_registry/runtime/action-adapter.ts`
- Create: `engine/domain-packs/packs/work_order_service/runtime/action-adapter.ts`
- Create: `engine/domain-packs/packs/inspection_rectification/runtime/action-adapter.ts`
- Create: `engine/domain-packs/packs/inventory_batch/runtime/action-adapter.ts`
- Create: `engine/domain-packs/packs/project_task/runtime/action-adapter.ts`
- Create: `engine/domain-packs/packs/application_archive/runtime/action-adapter.ts`
- Modify: `engine/domain-packs/packs/asset_registry/runtime/index.ts`
- Modify: `engine/domain-packs/packs/work_order_service/runtime/index.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/types.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/inspection-service.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/runtime/index.ts`
- Modify: `engine/domain-packs/packs/inventory_batch/runtime/index.ts`
- Modify: `engine/domain-packs/packs/project_task/runtime/index.ts`
- Modify: `engine/domain-packs/packs/application_archive/runtime/index.ts`
- Modify: `engine/domain-packs/tests/helpers/inspection-runtime.ts`
- Modify: `engine/domain-packs/tests/integration/inspection-execution.test.ts`
- Create: `engine/domain-packs/tests/integration/core-action-adapters.test.ts`
- Create: `engine/domain-packs/tests/integration/inspection-abnormal-handler.test.ts`

**Interfaces:**
- Produces: `PluginDomainAction { id, permission, parse, execute(context, payload) }`.
- Produces: `PluginActionContext { connection, actor, extensions, clock, codes, archiveStore }`; properties after `actor` are narrow immutable interfaces.
- Replaces inert IPC metadata with executable actions for all six core packs while preserving command IDs and permissions.
- Produces: `InspectionAbnormalDto { taskId, taskCode, itemId, itemCode, resultCode, recordedBy }`.
- Produces: `InspectionAbnormalHandler = (dto, bus) => void`.
- Adds: `InspectionContext.abnormalHandlers` and `InspectionContext.commandBus`.

- [ ] **Step 1: Write failing executable-adapter and abnormal-handler tests**

```ts
test('every core IPC contribution is an executable validated domain action', () => {
  for (const descriptor of coreDescriptors) {
    const actions = collectDomainActions(descriptor);
    assert.ok(actions.length > 0);
    for (const action of actions) {
      assert.equal(typeof action.parse, 'function');
      assert.equal(typeof action.execute, 'function');
    }
  }
});

test('invokes frozen abnormal handlers only for an abnormal result', () => {
  service.recordItemResult(abnormalRequest, inspectionContext(connection, inspector, {
    abnormalHandlers: [(dto, bus) => {
      assert.equal(Object.isFrozen(dto), true);
      bus.invoke('inspection.work_order.create', { itemCode: dto.itemCode });
    }]
  }));
  assert.equal(commandCalls, 1);
});

test('rolls back the item result, event and audit when a handler fails', () => {
  assert.throws(() => database.transaction((connection) => service.recordItemResult(
    abnormalRequest,
    inspectionContext(connection, inspector, { abnormalHandlers: [() => { throw new Error('bridge failed'); }] })
  )), /bridge failed/);
  assert.equal(readItemStatus(), 'pending');
});
```

- [ ] **Step 2: Run the new integration tests**

Run: `cd engine/domain-packs; node --import tsx --test tests/integration/core-action-adapters.test.ts tests/integration/inspection-abnormal-handler.test.ts`

Expected: FAIL because core actions are metadata-only and `abnormalHandlers` is not part of `InspectionContext`.

- [ ] **Step 3: Implement narrow executable adapters for all core services**

```ts
export interface PluginDomainAction {
  readonly id: string;
  readonly permission: string;
  readonly parse: (payload: Readonly<Record<string, JsonValue>>) => Readonly<Record<string, JsonValue>>;
  readonly execute: (context: PluginActionContext, payload: Readonly<Record<string, JsonValue>>) => JsonValue | void;
}
```

Each adapter builds only its owning service context from host-provided permissions, audit, clock, code generators, registered blockers/handlers, command bus, and optional archive store. It must not expose a connection or service instance to the renderer. Register these renderer-callable actions through `registerDomainActions`; reserve `registerDomainCommands` for internal cross-plugin commands. Retain `registerIpc` entries as declarative UI metadata until the desktop host migration is complete.

- [ ] **Step 4: Add the inspection DTO and invoke handlers before the owning transaction returns**

```ts
if (normalizedResult === 'abnormal') {
  const dto = Object.freeze({ taskId, taskCode, itemId, itemCode, resultCode, recordedBy: context.actor.username });
  for (const handler of context.abnormalHandlers) handler(dto, context.commandBus);
}
```

Do not pass the SQLite connection in the DTO. Keep normal results unchanged and register the handler extension through `registerCompletionHandlers`.

- [ ] **Step 5: Run all adapter, inspection, and full domain regressions**

Run: `cd engine/domain-packs; node --import tsx --test tests/integration/core-action-adapters.test.ts tests/integration/inspection-abnormal-handler.test.ts tests/integration/inspection-execution.test.ts; npm test`

Expected: all tests pass and the existing inspection acceptance counts remain unchanged.

- [ ] **Step 6: Commit**

```powershell
git add engine/domain-packs/src/runtime engine/domain-packs/packs engine/domain-packs/tests
git commit -m "feat: add executable core domain actions"
```

---

### Task 4: Asset and Work Order Production Bridge

**Files:**
- Create: `engine/domain-packs/packs/asset_work_order_bridge/catalog.json`
- Create: `engine/domain-packs/packs/asset_work_order_bridge/blueprint.json`
- Create: `engine/domain-packs/packs/asset_work_order_bridge/runtime/index.ts`
- Create: `engine/domain-packs/packs/asset_work_order_bridge/runtime/asset-work-order.ts`
- Create: `engine/domain-packs/packs/asset_work_order_bridge/ui/index.ts`
- Create: `engine/domain-packs/packs/asset_work_order_bridge/seed/index.ts`
- Create: `engine/domain-packs/packs/asset_work_order_bridge/tests/index.ts`
- Create: `engine/domain-packs/packs/asset_work_order_bridge/README.md`
- Create: `engine/domain-packs/tests/integration/asset-work-order-bridge.test.ts`
- Modify: `engine/domain-packs/packs/asset_registry/blueprint.json`
- Modify: `engine/domain-packs/src/runtime/production-catalog.ts`

**Interfaces:**
- Provides capability `bridge.asset_work_order` and requires `asset.core`, `work_order.core`.
- Produces: `createOpenWorkOrderAssetBlocker(): AssetLifecycleBlocker`.
- Extends: `work_order.fields`, `work_order.relations`, `work_order.detail.tabs`, `work_order.create.sources`, and `asset.detail.tabs`; add `asset.detail.tabs` as an explicit asset public extension point first.

- [ ] **Step 1: Write failing composition and SQLite tests**

```ts
test('composes asset and work-order fields, relations, tabs and create source', () => {
  const result = composeProduction(['asset_registry', 'work_order_service', 'asset_work_order_bridge']);
  assert.equal(result.canGenerate, true);
  assertReferenceField(result.blueprint, 'work_order', 'asset_code', 'asset');
});

test('blocks asset deactivation until every related work order is closed', () => {
  assert.throws(() => assets.changeStatus(deactivate, assetContext([blocker])), /open work order/);
  closeWorkOrder();
  assert.equal(assets.changeStatus(deactivateAfterClose, assetContext([blocker])).toStatus, 'inactive');
});
```

- [ ] **Step 2: Run the bridge test and verify missing-pack failure**

Run: `cd engine/domain-packs; node --import tsx --test tests/integration/asset-work-order-bridge.test.ts`

Expected: FAIL because the production bridge does not exist.

- [ ] **Step 3: Add strict catalog, fragment, blocker, descriptor, UI, seed, and acceptance entrypoints**

```ts
export function createOpenWorkOrderAssetBlocker(): AssetLifecycleBlocker {
  return (assetId, connection) => ({
    blocked: countOpenWorkOrders(assetId, connection) > 0,
    code: 'ASSET_HAS_OPEN_WORK_ORDERS',
    message: 'Asset has open work orders.'
  });
}
```

Use a stable asset reference on `work_order`; treat only `closed` as nonblocking. Register the blocker contribution under `asset.deactivation.work_order`.

- [ ] **Step 4: Register the descriptor and run validation/regression**

Run: `cd engine/domain-packs; npm run typecheck; node --import tsx --test tests/integration/asset-work-order-bridge.test.ts tests/integration/asset-lifecycle.test.ts tests/integration/work-order-lifecycle.test.ts; npm test`

Expected: all tests pass and production catalog descriptor count becomes eight.

- [ ] **Step 5: Commit**

```powershell
git add engine/domain-packs
git commit -m "feat: add asset work order bridge"
```

---

### Task 5: Asset and Inspection Production Bridge

**Files:**
- Create: `engine/domain-packs/packs/asset_inspection_bridge/catalog.json`
- Create: `engine/domain-packs/packs/asset_inspection_bridge/blueprint.json`
- Create: `engine/domain-packs/packs/asset_inspection_bridge/runtime/index.ts`
- Create: `engine/domain-packs/packs/asset_inspection_bridge/runtime/asset-inspection.ts`
- Create: `engine/domain-packs/packs/asset_inspection_bridge/ui/index.ts`
- Create: `engine/domain-packs/packs/asset_inspection_bridge/seed/index.ts`
- Create: `engine/domain-packs/packs/asset_inspection_bridge/tests/index.ts`
- Create: `engine/domain-packs/packs/asset_inspection_bridge/README.md`
- Create: `engine/domain-packs/tests/integration/asset-inspection-bridge.test.ts`
- Modify: `engine/domain-packs/packs/inspection_rectification/blueprint.json`
- Modify: `engine/domain-packs/src/runtime/production-catalog.ts`

**Interfaces:**
- Provides `bridge.asset_inspection`; requires `asset.core`, `inspection.core`.
- Produces: `createOpenInspectionAssetBlocker(): AssetLifecycleBlocker`.
- Extends inspection task/plan asset references and asset detail history through public points. Add `inspection_plan.fields` and `inspection_plan.relations` to the core pack before consuming them.

- [ ] **Step 1: Write failing bridge tests**

```ts
test('requires an active asset when an inspection task is created', () => {
  assert.throws(() => createTaskForInactiveAsset(), /active asset/);
});

test('blocks deactivation for an unarchived task and keeps archived history visible', () => {
  assert.equal(blocker(assetId, connection).blocked, true);
  archiveTask();
  assert.equal(blocker(assetId, connection).blocked, false);
  assert.equal(readAssetInspectionHistory(assetId, connection).length, 1);
});
```

- [ ] **Step 2: Run and observe missing bridge failures**

Run: `cd engine/domain-packs; node --import tsx --test tests/integration/asset-inspection-bridge.test.ts`

Expected: FAIL because the bridge descriptor and relation do not exist.

- [ ] **Step 3: Implement strict fragment, blocker, history query, UI, seed, and descriptor**

```ts
export const NON_ARCHIVED_INSPECTION_STATUSES = Object.freeze([
  'planned', 'assigned', 'executing', 'pending_review'
]);
```

Resolve the asset by stable code, reject missing/inactive assets before task creation, and leave archived history immutable.

- [ ] **Step 4: Run focused and full domain tests**

Run: `cd engine/domain-packs; npm run typecheck; node --import tsx --test tests/integration/asset-inspection-bridge.test.ts tests/integration/inspection-lifecycle.test.ts tests/integration/asset-lifecycle.test.ts; npm test`

Expected: all pass; catalog descriptor count becomes nine.

- [ ] **Step 5: Commit**

```powershell
git add engine/domain-packs
git commit -m "feat: add asset inspection bridge"
```

---

### Task 6: Inspection Abnormality to Work Order Production Bridge

**Files:**
- Create: `engine/domain-packs/packs/inspection_work_order_bridge/catalog.json`
- Create: `engine/domain-packs/packs/inspection_work_order_bridge/blueprint.json`
- Create: `engine/domain-packs/packs/inspection_work_order_bridge/runtime/index.ts`
- Create: `engine/domain-packs/packs/inspection_work_order_bridge/runtime/inspection-work-order.ts`
- Create: `engine/domain-packs/packs/inspection_work_order_bridge/ui/index.ts`
- Create: `engine/domain-packs/packs/inspection_work_order_bridge/seed/index.ts`
- Create: `engine/domain-packs/packs/inspection_work_order_bridge/tests/index.ts`
- Create: `engine/domain-packs/packs/inspection_work_order_bridge/README.md`
- Create: `engine/domain-packs/tests/integration/inspection-work-order-bridge.test.ts`
- Modify: `engine/domain-packs/src/runtime/production-catalog.ts`

**Interfaces:**
- Provides `bridge.inspection_work_order`; requires `inspection.core`, `work_order.core`.
- Owns entity `inspection_work_order_link` with unique `inspection_item_code` and `work_order_code`.
- Produces command `inspection.work_order.create` and `createOpenRectificationBlocker(): InspectionArchiveBlocker`.

- [ ] **Step 1: Write failing atomicity, idempotency, and archive-block tests**

```ts
test('creates one work order and link in the abnormal result transaction', () => {
  recordAbnormal();
  assert.equal(count('biz_work_order'), 1);
  assert.equal(count('biz_inspection_work_order_link'), 1);
  recordSameAbnormalAgain();
  assert.equal(count('biz_work_order'), 1);
});

test('rolls back result, work order, link, event and audit on injected failure', () => {
  assert.throws(() => recordAbnormal({ failAfterWorkOrder: true }), /injected/);
  assert.equal(count('biz_work_order'), 0);
  assert.equal(count('biz_inspection_work_order_link'), 0);
  assert.equal(readInspectionItemResult(), null);
});
```

- [ ] **Step 2: Run and verify missing command/link failures**

Run: `cd engine/domain-packs; node --import tsx --test tests/integration/inspection-work-order-bridge.test.ts`

Expected: FAIL because the bridge command is unregistered.

- [ ] **Step 3: Implement command, relation entity, unique keys, blocker, UI, seed, and descriptor**

```ts
export const INSPECTION_WORK_ORDER_COMMAND = 'inspection.work_order.create';
export const inspectionWorkOrderDefinition: DomainCommandDefinition = {
  id: INSPECTION_WORK_ORDER_COMMAND,
  allowedSources: ['inspection_work_order_bridge'],
  parse: parseInspectionWorkOrderPayload,
  execute: createLinkedRectificationWorkOrder
};
```

Call `WorkOrderService.create` with a bridge-built `WorkOrderContext`; insert the link only after service success in the same connection. A unique conflict returns the existing linked work order only when the normalized payload matches.

- [ ] **Step 4: Run bridge, inspection, work-order and full regressions**

Run: `cd engine/domain-packs; npm run typecheck; node --import tsx --test tests/integration/inspection-work-order-bridge.test.ts tests/integration/inspection-lifecycle.test.ts tests/integration/work-order-lifecycle.test.ts; npm test`

Expected: all pass; catalog descriptor count becomes ten.

- [ ] **Step 5: Commit**

```powershell
git add engine/domain-packs
git commit -m "feat: bridge inspection abnormalities to work orders"
```

---

### Task 7: Inventory and Application Production Bridge

**Files:**
- Create: `engine/domain-packs/packs/inventory_application_bridge/catalog.json`
- Create: `engine/domain-packs/packs/inventory_application_bridge/blueprint.json`
- Create: `engine/domain-packs/packs/inventory_application_bridge/runtime/index.ts`
- Create: `engine/domain-packs/packs/inventory_application_bridge/runtime/inventory-application.ts`
- Create: `engine/domain-packs/packs/inventory_application_bridge/ui/index.ts`
- Create: `engine/domain-packs/packs/inventory_application_bridge/seed/index.ts`
- Create: `engine/domain-packs/packs/inventory_application_bridge/tests/index.ts`
- Create: `engine/domain-packs/packs/inventory_application_bridge/README.md`
- Create: `engine/domain-packs/tests/integration/inventory-application-bridge.test.ts`
- Modify: `engine/domain-packs/src/runtime/production-catalog.ts`

**Interfaces:**
- Provides `bridge.inventory_application`; requires `inventory.core`, `application.core`.
- Owns entity `application_inventory_issue` with unique `(application_code, approval_round)`.
- Produces command `inventory.application.issue` and a final-approval completion handler.

- [ ] **Step 1: Write failing approval and rollback tests**

```ts
test('deducts once only after final approval', () => {
  approveFirstNode();
  assert.equal(readQuantity(), 20);
  approveFinalNode();
  assert.equal(readQuantity(), 17);
  replayFinalCompletion();
  assert.equal(readQuantity(), 17);
});

test('reject, withdrawal, insufficient stock and injected audit failure do not deduct', () => {
  rejectApplication();
  assert.equal(readQuantity(), 20);
  assert.throws(() => approveWithInsufficientStock(), /Insufficient inventory/);
  assert.equal(readQuantity(), 20);
});
```

- [ ] **Step 2: Run and verify missing bridge failures**

Run: `cd engine/domain-packs; node --import tsx --test tests/integration/inventory-application-bridge.test.ts`

Expected: FAIL because approval has no inventory completion handler.

- [ ] **Step 3: Implement application extensions, idempotent link, system actor, command, UI, and descriptor**

```ts
const bridgeActor = Object.freeze({
  userId: application.applicationId,
  username: `application:${application.applicationCode}`,
  displayName: 'Approved inventory application',
  roleId: 'inventory_application_bridge'
});
```

Preserve applicant and approver IDs in the link/audit details. Invoke `InventoryService.issueStock`; do not grant the system actor any command except this registered issue path.

- [ ] **Step 4: Run application, inventory, bridge, and full tests**

Run: `cd engine/domain-packs; npm run typecheck; node --import tsx --test tests/integration/inventory-application-bridge.test.ts tests/integration/application-approval.test.ts tests/integration/inventory-movement.test.ts; npm test`

Expected: all pass; catalog descriptor count becomes eleven.

- [ ] **Step 5: Commit**

```powershell
git add engine/domain-packs
git commit -m "feat: bridge approved applications to inventory"
```

---

### Task 8: Project Delivery Archive Production Bridge

**Files:**
- Create: `engine/domain-packs/packs/project_archive_bridge/catalog.json`
- Create: `engine/domain-packs/packs/project_archive_bridge/blueprint.json`
- Create: `engine/domain-packs/packs/project_archive_bridge/runtime/index.ts`
- Create: `engine/domain-packs/packs/project_archive_bridge/runtime/project-archive.ts`
- Create: `engine/domain-packs/packs/project_archive_bridge/ui/index.ts`
- Create: `engine/domain-packs/packs/project_archive_bridge/seed/index.ts`
- Create: `engine/domain-packs/packs/project_archive_bridge/tests/index.ts`
- Create: `engine/domain-packs/packs/project_archive_bridge/README.md`
- Create: `engine/domain-packs/tests/integration/project-archive-bridge.test.ts`
- Modify: `engine/domain-packs/src/runtime/production-catalog.ts`

**Interfaces:**
- Provides `bridge.project_archive`; requires `project.core`, `archive.core`.
- Owns append-only entity `project_delivery_archive`.
- Produces: `linkReadyDeliveryArchive(request, context)` and `createRequiredArchiveCloseBlocker(): ProjectCloseBlocker`.

- [ ] **Step 1: Write failing immutable-link and close-block tests**

```ts
test('links an accepted deliverable version to a ready file version exactly once', () => {
  const result = linkReadyDeliveryArchive(request, context);
  assert.equal(result.deliverableCode, acceptedDeliverableCode);
  assert.throws(() => linkReadyDeliveryArchive(conflictingRequest, context), /conflict/);
});

test('blocks project close until every required accepted deliverable is archived', () => {
  assert.equal(blocker(projectId, connection).blocked, true);
  archiveRequiredDeliverables();
  assert.equal(blocker(projectId, connection).blocked, false);
});
```

- [ ] **Step 2: Run and verify missing entity/service failures**

Run: `cd engine/domain-packs; node --import tsx --test tests/integration/project-archive-bridge.test.ts`

Expected: FAIL because the production bridge is absent.

- [ ] **Step 3: Implement strict links, ready-file validation, close blocker, UI, seed, and descriptor**

```ts
export interface LinkDeliveryArchiveRequest {
  readonly projectId: number;
  readonly deliverableId: number;
  readonly fileVersionCode: string;
}
```

Read the accepted deliverable and ready file inside the same connection, insert an append-only relation, reject updates/deletes through generic CRUD, and register the project close blocker.

- [ ] **Step 4: Run project, archive, bridge, and full regressions**

Run: `cd engine/domain-packs; npm run typecheck; node --import tsx --test tests/integration/project-archive-bridge.test.ts tests/integration/project-close.test.ts tests/integration/application-file-version.test.ts; npm test`

Expected: all pass; the production catalog contains twelve unique descriptors.

- [ ] **Step 5: Commit**

```powershell
git add engine/domain-packs
git commit -m "feat: add project delivery archive bridge"
```

---

### Task 9: Complete the Eight-Combination Matrix

**Files:**
- Create: `engine/domain-packs/tests/helpers/production-packs.ts`
- Create: `engine/domain-packs/tests/combinations/asset-work-order.test.ts`
- Create: `engine/domain-packs/tests/combinations/asset-inspection.test.ts`
- Create: `engine/domain-packs/tests/combinations/inspection-work-order.test.ts`
- Create: `engine/domain-packs/tests/combinations/inventory-application.test.ts`
- Create: `engine/domain-packs/tests/combinations/project-task.test.ts`
- Create: `engine/domain-packs/tests/combinations/project-archive.test.ts`
- Create: `engine/domain-packs/tests/combinations/application-archive.test.ts`
- Create: `engine/domain-packs/tests/combinations/reference-composition.test.ts`
- Modify: `engine/domain-packs/package.json`

**Interfaces:**
- Produces: `loadProductionPacks(ids): Promise<PackRegistry>` and `composeProduction(ids, overrides?)`.
- Adds script: `test:combinations`.

- [ ] **Step 1: Write the matrix tests using real pack directories and descriptors**

```ts
const MATRIX = Object.freeze([
  ['asset_registry', 'work_order_service', 'asset_work_order_bridge'],
  ['asset_registry', 'inspection_rectification', 'asset_inspection_bridge'],
  ['inspection_rectification', 'work_order_service', 'inspection_work_order_bridge'],
  ['inventory_batch', 'application_archive', 'inventory_application_bridge'],
  ['project_task'],
  ['project_task', 'application_archive', 'project_archive_bridge'],
  ['application_archive'],
  ['asset_registry', 'work_order_service', 'inspection_rectification', 'asset_work_order_bridge', 'asset_inspection_bridge', 'inspection_work_order_bridge']
]);
```

Each file asserts composition, exact dependency order, ownership, plugin activation, positive flow, permission denial, invalid state, rollback, and deterministic domain lock. Core-only combinations explicitly state that their cross-concern is owned by the core pack.

- [ ] **Step 2: Run the new matrix script and inspect all failures**

Run: `cd engine/domain-packs; npm run test:combinations`

Expected: initial failures expose any missing public extension point, dependency order, contribution registration, or exact blueprint assertion.

- [ ] **Step 3: Correct only production descriptors/fragments needed by matrix failures**

```ts
assert.deepEqual(result.lock?.dependencyOrder, expectedDependencyOrder);
assert.equal(result.report.ownership[ownedEntity], expectedOwner);
assert.equal(canonicalJson(first.lock), canonicalJson(second.lock));
```

Do not introduce fixture-only adapters. Every corrected path must load from `packs/` and the production catalog.

- [ ] **Step 4: Run all domain tests and build both CLIs**

Run: `cd engine/domain-packs; npm run typecheck; npm test; npm run test:combinations; npm run build; npm run build:runtime-catalog`

Expected: every command exits `0`; eight matrix files pass.

- [ ] **Step 5: Commit**

```powershell
git add engine/domain-packs
git commit -m "test: enforce production domain combination matrix"
```

---

### Task 10: Delivery-Level Project Lock and Resource Verification

**Files:**
- Create: `engine/desktop-runtime/src/core/project-lock.ts`
- Create: `engine/desktop-runtime/src/core/upgrade-report.ts`
- Modify: `engine/desktop-runtime/src/main/index.ts`
- Modify: `engine/desktop-runtime/tools/copy-runtime-resources.cjs`
- Create: `engine/desktop-runtime/tests/unit/project-lock.test.ts`
- Modify: `engine/desktop-runtime/tests/integration/package-contract.test.ts`

**Interfaces:**
- Produces: `createProjectLock(input): ProjectLock`, `compareProjectLocks(previous, next): ProjectUpgradeReport`, and `verifyProjectResources(resources): VerifiedProjectResources`.
- `project.lock.json` contains generator, blueprint schema, domain-lock digest, pack versions, database schema, runtime/Electron/Node/SQLite versions, normalized config digest, build target, and lock format `1.0`.
- Resource manifest hashes blueprint, seed, domain lock, project lock, and production catalog bundle.

- [ ] **Step 1: Write failing canonical-lock and tamper tests**

```ts
test('creates byte-stable project locks for equivalent normalized input', () => {
  assert.equal(canonicalProjectLock(first), canonicalProjectLock(reordered));
});

test('rejects a changed blueprint, seed, domain lock, project lock or plugin bundle', () => {
  for (const filename of protectedResources) {
    tamper(filename);
    assert.throws(() => verifyProjectResources(directory), new RegExp(filename));
    restore(filename);
  }
});

test('reports every pack, schema and runtime change and requires migration evidence', () => {
  const report = compareProjectLocks(previous, next);
  assert.deepEqual(report.changedPacks, [{ id: 'asset_registry', from: '1.0.0', to: '1.1.0' }]);
  assert.equal(report.allowed, false);
  assert.deepEqual(report.requiredChecks, ['migration', 'asset_registry', 'combinations']);
});
```

- [ ] **Step 2: Run and verify missing project-lock module**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/project-lock.test.ts tests/integration/package-contract.test.ts`

Expected: FAIL because only the blueprint hash exists today and no upgrade report exists.

- [ ] **Step 3: Implement canonical lock creation and all-resource manifest verification**

```ts
export interface ProjectLock {
  readonly lockVersion: '1.0';
  readonly generatorVersion: string;
  readonly blueprintSchemaVersion: '1.0';
  readonly domainLockSha256: string;
  readonly packs: readonly Readonly<{ id: string; version: string }>[];
  readonly databaseSchemaVersion: number;
  readonly runtime: Readonly<{ desktop: string; electron: string; node: string; sqlite: string }>;
  readonly projectConfigSha256: string;
  readonly buildTarget: 'win-nsis-x64';
}
```

Verify all hashes before opening SQLite or activating plugins. Reject a lock pack/order mismatch against `domain-lock.json`.

`compareProjectLocks` emits canonical JSON listing added, removed and changed packs, schema/runtime changes, required migrations and affected test suites. An upgrade becomes allowed only after the caller supplies successful migration and required-test evidence; ordinary startup never performs this upgrade implicitly.

- [ ] **Step 4: Run runtime typecheck, unit, and integration tests**

Run: `cd engine/desktop-runtime; npm run typecheck; npm run test:unit; npm run test:integration`

Expected: all pass, including tamper failures.

- [ ] **Step 5: Commit**

```powershell
git add engine/desktop-runtime
git commit -m "feat: lock and verify generated project resources"
```

---

### Task 11: Deterministic Reference Project Assembly and 1000-Row Seed

**Files:**
- Create: `engine/desktop-runtime/reference/asset-operations/project.json`
- Create: `engine/desktop-runtime/reference/asset-operations/generate-seed.ts`
- Create: `engine/desktop-runtime/reference/asset-operations/accounts.json`
- Create: `engine/desktop-runtime/tools/build-project-resources.cjs`
- Modify: `engine/desktop-runtime/tools/copy-runtime-resources.cjs`
- Modify: `engine/desktop-runtime/package.json`
- Create: `engine/desktop-runtime/tests/unit/reference-seed.test.ts`
- Create: `engine/desktop-runtime/tests/integration/reference-resources.test.ts`

**Interfaces:**
- Produces: `generateReferenceSeed({ seed: 20260920, businessRows: 1000, baseline: '2026-09-20T00:00:00.000Z' })`.
- Produces: `build-project-resources.cjs --project <project.json> --output <directory>`.
- Adds scripts: `build:fixture` and `build:reference`; `build` remains fixture-compatible until Task 13 switches E2E explicitly.

- [ ] **Step 1: Write failing seed count, determinism, chronology, and composition tests**

```ts
test('generates exactly 1000 counted business rows deterministically', () => {
  const first = generateReferenceSeed(input);
  const second = generateReferenceSeed(input);
  assert.equal(first.report.countedBusinessRows, 1000);
  assert.deepEqual(first, second);
});

test('all references, unique keys, state timelines and dashboard cohorts are valid', () => {
  assertSeedReferences(seed);
  assertSeedChronology(seed);
  assert.ok(seed.report.cohorts.abnormalOpen > 0);
  assert.ok(seed.report.cohorts.closed > 0);
});
```

- [ ] **Step 2: Run and verify missing reference assembler failures**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/reference-seed.test.ts tests/integration/reference-resources.test.ts`

Expected: FAIL because the reference project and generator do not exist.

- [ ] **Step 3: Define the portable reference project and deterministic generator**

```json
{
  "id": "asset_operations_reference",
  "packs": [
    "asset_registry",
    "work_order_service",
    "inspection_rectification",
    "asset_work_order_bridge",
    "asset_inspection_bridge",
    "inspection_work_order_bridge"
  ],
  "seed": { "value": 20260920, "businessRows": 1000, "baseline": "2026-09-20T00:00:00.000Z" }
}
```

Generate relationships from stable codes first, then states/events in chronological order. `accounts.json` stores only usernames, role IDs, and password-digest field names. Unit tests inject fixed digest fixtures; E2E generates four ephemeral plaintext passwords in memory, passes them to the assembler through child-process environment variables, and stores only scrypt digests in `seed.json`. The variables are removed after the child exits, and no plaintext password is written under the repository.

- [ ] **Step 4: Implement project resource assembly through the real composer**

The assembler resolves pack roots relative to the repository, invokes the production composer, writes canonical `blueprint.json` and `domain-lock.json`, generates `seed.json`, creates `project.lock.json`, builds the production catalog bundle, and writes the complete resource manifest through a sibling staging directory followed by atomic rename.

- [ ] **Step 5: Run deterministic assembly twice and compare every artifact**

Run: `cd engine/desktop-runtime; npm run build:reference; node --import tsx --test tests/unit/reference-seed.test.ts tests/integration/reference-resources.test.ts`

Expected: all pass; the two test builds have identical hashes; counted business rows equal `1000`; blueprint has six selected plugins and at least twelve modules.

- [ ] **Step 6: Commit**

```powershell
git add engine/desktop-runtime/reference engine/desktop-runtime/tools engine/desktop-runtime/package.json engine/desktop-runtime/tests
git commit -m "feat: assemble deterministic reference application"
```

---

### Task 12: Activate Production Plugins in Electron and Expose Domain Actions

**Files:**
- Modify: `engine/desktop-runtime/src/main/index.ts`
- Modify: `engine/desktop-runtime/src/main/ipc-handlers.ts`
- Modify: `engine/desktop-runtime/src/shared/ipc.ts`
- Modify: `engine/desktop-runtime/src/preload/api.ts`
- Modify: `engine/desktop-runtime/src/preload/global.d.ts`
- Create: `engine/desktop-runtime/src/core/domain-command-service.ts`
- Create: `engine/desktop-runtime/src/renderer/components/DomainActions.tsx`
- Create: `engine/desktop-runtime/src/renderer/components/RelatedRecords.tsx`
- Modify: `engine/desktop-runtime/src/renderer/components/EntityDetail.tsx`
- Modify: `engine/desktop-runtime/src/renderer/screens/ModuleScreen.tsx`
- Create: `engine/desktop-runtime/tests/integration/domain-command-ipc.test.ts`
- Modify: `engine/desktop-runtime/tests/unit/ipc-contract.test.ts`
- Modify: `engine/desktop-runtime/tests/e2e/ui-contract.spec.ts`

**Interfaces:**
- Produces: IPC channel `business:domain:execute` with strict `{ token, commandId, payload }` schema.
- Produces: preload method `domain.execute(token, commandId, payload)`.
- Produces: `DomainCommandService.execute(commandId, payload, actor)` which opens one runtime transaction and dispatches only activated definitions.

- [ ] **Step 1: Write failing host activation and IPC tests**

```ts
test('requires a session, permission and activated allowlisted command', async () => {
  assert.equal((await invokeWithoutToken()).error.code, 'VALIDATION_FAILED');
  assert.equal((await invokeForbiddenActor()).error.code, 'PERMISSION_DENIED');
  assert.equal((await invokeUnknownCommand()).error.code, 'NOT_FOUND');
});

test('rolls back all plugin writes and returns a stable redacted error', async () => {
  const response = await invokeInjectedFailure();
  assert.equal(response.error.code, 'INTERNAL_ERROR');
  assert.equal(countBridgeRows(), 0);
  assert.doesNotMatch(JSON.stringify(response), /SELECT|sqlite|D:\\\\/i);
});
```

- [ ] **Step 2: Run and verify missing channel/service failures**

Run: `cd engine/desktop-runtime; node --import tsx --test tests/unit/ipc-contract.test.ts tests/integration/domain-command-ipc.test.ts`

Expected: FAIL because domain execution is not exposed.

- [ ] **Step 3: Load, verify, register, activate, and freeze production plugins before window creation**

```ts
const descriptors = loadProductionPluginCatalog(resources.productionCatalogPath);
for (const descriptor of descriptors) registry.register(descriptor);
registry.assertCompatible(blueprint.plugins, blueprint.schemaVersion);
registry.assertLocked(resources.domainLock);
registry.activate(blueprint.plugins, host, resources.domainLock.dependencyOrder);
const plugins = host.freeze();
```

Apply plugin migrations before seed insertion. Bind blockers and completion handlers by contribution ID. Startup fails closed on missing plugins, digest mismatch, duplicates, or incompatible versions.

- [ ] **Step 4: Add strict domain IPC and preload API**

```ts
domainExecute: 'business:domain:execute'
```

The Zod schema accepts a command ID matching `^[a-z][a-z0-9_.]{2,95}$` and a JSON record whose serialized size is at most 64 KiB. The main process resolves the actor, checks the contribution permission, and runs the handler through `RuntimeDatabase.transaction`.

- [ ] **Step 5: Render fixed-slot domain actions and related records**

`DomainActions` renders only actions contributed for the current entity/status/role. `RelatedRecords` renders only declared detail tabs. Use existing form, table, error, confirmation, focus, and button styles; do not render arbitrary component source from a plugin.

- [ ] **Step 6: Run typecheck, runtime tests, and a reference build**

Run: `cd engine/desktop-runtime; npm run typecheck; npm run test:unit; npm run test:integration; npm run build:reference`

Expected: all pass; `--verify` exits `0` only after six reference plugins activate.

- [ ] **Step 7: Commit**

```powershell
git add engine/desktop-runtime
git commit -m "feat: activate production domain plugins in desktop runtime"
```

---

### Task 13: Reference Electron E2E, Persistence, Installer, and Release Evidence

**Files:**
- Create: `engine/desktop-runtime/tests/e2e/reference.spec.ts`
- Modify: `engine/desktop-runtime/playwright.config.ts`
- Modify: `engine/desktop-runtime/tools/verify-package.cjs`
- Modify: `engine/desktop-runtime/tools/verify-installer.ps1`
- Modify: `engine/desktop-runtime/electron-builder.yml`
- Create: `engine/desktop-runtime/tools/write-acceptance-report.cjs`
- Modify: `engine/desktop-runtime/README.md`
- Modify: `engine/domain-packs/README.md`
- Create: `docs/reference-application-acceptance.md`

**Interfaces:**
- Adds script: `test:e2e:reference` that sets the explicit reference project resource path.
- Produces: `dist/reports/reference-acceptance.json` with test counts, resource hashes, seed counts, restart result, package result, installer result, and timestamp.

- [ ] **Step 1: Write the full failing Playwright scenario**

```ts
test('four roles close an inspection abnormality and preserve it across restart', async () => {
  const credentials = await buildReferenceWithEphemeralCredentials();
  await loginAs('dispatcher', credentials.dispatcher);
  await createAssetInspectionPlan();
  await loginAs('operator', credentials.operator);
  await recordAbnormalInspection();
  await expectLinkedWorkOrderCount(1);
  await expectAssetDeactivationBlocked();
  await expectInspectionArchiveBlocked();
  await processWorkOrder();
  await loginAs('reviewer', credentials.reviewer);
  await closeWorkOrderAndArchiveInspection();
  await loginAs('administrator', credentials.administrator);
  await deactivateAssetAndCheckDashboardAudit();
  await restartApplication();
  await expectClosedStatePersistedInUiAndSqlite();
});
```

Add separate E2E cases for role denial, duplicate abnormal submission, and injected bridge rollback.

- [ ] **Step 2: Run the reference E2E and capture concrete failures**

Run: `cd engine/desktop-runtime; npm run test:e2e:reference`

Expected: initial failures identify any missing accessible label, action binding, role permission, persistence assertion, or reference build switch.

- [ ] **Step 3: Make the smallest UI/runtime corrections required by the scenario**

Use role/name selectors and stable accessible labels. Confirm the database directly after first shutdown: one abnormal link, one work order, closed work-order state, archived inspection state, inactive asset state, and matching audit events.

- [ ] **Step 4: Strengthen package and installer verification**

```js
assertResource('blueprint.json');
assertResource('seed.json');
assertResource('domain-lock.json');
assertResource('project.lock.json');
assertResource('production-runtime-catalog.cjs');
assertNoFixtureCredentialsOrDatabase(unpackedRoot);
```

Parameterize product name/artifact from the reference project while preserving the generic fixture build. Installer verification must install into an isolated temporary directory, run the installed executable with `--verify`, assert exit code `0`, and uninstall without deleting unrelated user data.

- [ ] **Step 5: Run the complete verification ladder**

Run: `cd engine/domain-packs; npm run typecheck; npm test; npm run test:combinations; npm run build; npm run build:runtime-catalog`

Run: `cd engine/desktop-runtime; npm run typecheck; npm run test:unit; npm run test:integration; npm run build:reference; npm run test:e2e:reference; npm run dist:win`

Run: `cd engine/desktop-runtime; node tools/verify-package.cjs --unpacked (Resolve-Path '.\dist\installers\win-unpacked').Path`

Run: `cd engine/desktop-runtime; powershell -NoProfile -ExecutionPolicy Bypass -File '.\tools\verify-installer.ps1' -InstallerPath (Resolve-Path '.\dist\installers\资产巡检整改管理软件 V1.0.0 安装包.exe').Path`

Expected: every command exits `0`; restart persistence and installed `--verify` pass.

- [ ] **Step 6: Write acceptance evidence and documentation**

Document the 12 views, four demonstration roles, non-plaintext account handoff, two workflows, three bridges, 1000-row seed report, lock files, backup location, test commands, installer verification, and upgrade rule. The JSON report records exact hashes and statuses but no password or local absolute path.

- [ ] **Step 7: Check repository hygiene**

Run: `git status --short; rg -n "ghp_|github_pat_|Dispatch123!|Operator123!|Review123!" --glob '!docs/superpowers/**' --glob '!engine/desktop-runtime/fixtures/**' .`

Expected: only intended source/document changes are present; no token matches; reference resources contain password digests rather than plaintext passwords.

- [ ] **Step 8: Commit final acceptance unit**

```powershell
git add engine/domain-packs/README.md engine/desktop-runtime docs/reference-application-acceptance.md
git commit -m "test: complete reference application acceptance"
```

- [ ] **Step 9: Review final branch before push**

Run: `git status --short; git log --oneline --decorate -15; git diff --check origin/feature/next-update...HEAD`

Expected: clean worktree, thirteen scoped implementation commits after this plan, and no whitespace errors.
