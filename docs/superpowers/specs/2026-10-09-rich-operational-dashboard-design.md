# Rich Operational Dashboard Design

## Status

Approved direction for the standard business generator. This design applies to all eight supported standard templates and does not change the legacy demo mode.

## Problem

The desktop dashboard currently renders only the blueprint's flat counter list and a hard-coded empty message. It leaves most of the first viewport unused and can contradict the data, for example showing nonzero pending reviews while also saying that no work requires attention.

Five production domain packs already register `dashboard.sections` UI extensions backed by real summary actions that accept an empty strict payload:

- application archive
- inspection rectification
- work order service
- inventory batch
- project task

The runtime activates these contributions but never consumes them. The missing behavior is therefore a runtime integration gap, not a need for fabricated dashboard data.

## Goals

- Give every standard template a useful first-screen operational summary.
- Render only values returned from the locked blueprint, database, and activated domain packs.
- Distinguish stable status information from work that requires attention.
- Let users navigate from a dashboard item to its owning module.
- Respect the current actor's composed permissions.
- Preserve the quiet, dense visual language of the existing desktop runtime.
- Keep dashboard behavior deterministic and testable across all eight template combinations.

## Non-Goals

- No invented trends, percentages, financial values, charts, alerts, or recent activity.
- No time-series subsystem or analytics database.
- No generic renderer access to arbitrary domain commands.
- No record mutation from the dashboard.
- No template-specific React page for each business domain.
- No change to generated entity schemas, migrations, workflows, or transaction rules.

## Chosen Approach

Use the existing `dashboard.sections` extension point as a declarative presentation contract. Each contributing domain pack declares how fields from its existing summary action map to status rows and attention rows. The main process validates the descriptor, verifies the backing action and permission, invokes allowed summary actions server-side, and returns one normalized dashboard snapshot to the renderer.

This is preferred over two alternatives:

1. Frontend-only inference from metric names or IDs would be quick but brittle, language-dependent, and unable to consume the richer summaries already implemented.
2. Domain-specific React dashboards would provide maximum freedom but duplicate layout, permission, loading, and navigation behavior across packs.

## Contribution Contract

A `dashboard.sections` contribution keeps its existing identity fields and adds a `presentation` object:

```ts
interface DashboardSectionContribution {
  readonly id: string;
  readonly slot: 'dashboard.sections';
  readonly label: string;
  readonly order: number;
  readonly viewId: string;
  readonly dataSource: string;
  readonly presentation: {
    readonly groups: readonly DashboardGroupDefinition[];
  };
}

interface DashboardGroupDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: 'status' | 'attention';
  readonly items: readonly DashboardItemDefinition[];
}

interface DashboardItemDefinition {
  readonly id: string;
  readonly sourceKey: string;
  readonly label: string;
  readonly tone: 'neutral' | 'teal' | 'amber' | 'red';
  readonly moduleId?: string;
}
```

Rules:

- IDs are unique lower-snake-case values within their scope.
- `dataSource` must identify an activated domain action whose strict parser accepts an empty payload and whose implementation is covered as read-only.
- `sourceKey` must exist in the summary result and resolve to a finite nonnegative number.
- `moduleId`, when present, must identify a module in the locked blueprint.
- Groups contain one to twelve items; a section contains one to three groups.
- Unknown properties, duplicate IDs, missing keys, invalid numbers, and unsafe module references fail closed as `BLUEPRINT_INCOMPATIBLE`.
- Pack descriptors are immutable after activation.

The five contributing packs will declare mappings for their existing summaries. Status groups cover lifecycle distribution such as project states or application states. Attention groups cover actionable or exceptional counts such as pending reviews, overdue work, open high risks, expiry warnings, failed files, and abnormal inspections. Inventory may additionally expose its existing recent transactions as a bounded read-only activity group in a later change; it is excluded from this version because the common contract is numeric.

## Runtime Snapshot

The existing `business:dashboard:read` channel remains the only dashboard IPC surface. Its response changes from a metric array to a normalized object:

```ts
interface DashboardSnapshotDto {
  readonly metrics: readonly DashboardMetricDto[];
  readonly sections: readonly DashboardSectionDto[];
}
```

`metrics` preserves the current blueprint-defined KPI counters. `sections` contains permission-filtered, sorted, normalized groups from activated pack contributions. Returned objects and arrays are frozen before crossing the service boundary.

The main process constructs `DashboardService` with the activated plugin host, permission service, and domain command service. Dashboard reads follow this order:

1. Evaluate existing blueprint metrics.
2. Select `dashboard.sections` contributions in stable `order`, then `id` order.
3. Resolve and validate each data source action.
4. Omit a section when the actor lacks its action permission.
5. Execute each permitted summary action with an empty payload.
6. Normalize declared numeric keys into groups and items.
7. Return a snapshot only after every permitted section succeeds; do not publish a partial result.

A permitted summary failure fails the dashboard request. It must not be converted to an empty task list, because that would falsely report a healthy state. Permission-based omission is the only silent omission.

## Renderer Experience

The dashboard uses one responsive workspace rather than nested cards:

- Header: title, factual subtitle, and a refresh icon button.
- KPI band: the existing four to six blueprint counters.
- Status overview: compact horizontal rows with label, value, and proportional bar. Bars are relative to the largest value in the same group and do not claim a time trend.
- Work requiring attention: nonzero attention items ordered by severity and descriptor order. Each row shows label, count, and a navigation button when a target module is declared.
- Empty attention state: shown only when all accessible attention items are zero.
- Business entry band: compact buttons for the same modules already exposed in the sidebar metadata, not duplicated configuration.

Selecting an attention item or business entry changes the current module through the existing `App` selection state. It does not silently apply a list filter because filter state is not part of the current module navigation contract.

At desktop width the status and attention regions use two columns. At narrower widths they stack. KPI cards use three, two, then one column according to available space. Controls and labels must not resize the surrounding layout.

## Loading And Error States

The renderer tracks dashboard state explicitly:

- `loading`: stable skeleton or loading region; old data is not labeled current.
- `ready`: render the validated snapshot.
- `error`: show a concise retry action; never show the empty-attention message.

Refresh uses the same read channel and preserves the current authenticated session. Login, logout, and navigation clear stale dashboard errors and values consistently.

## Security And Data Boundaries

- The renderer receives normalized display DTOs, not action definitions or executable descriptors.
- The renderer cannot choose a dashboard data source or invoke arbitrary summary commands.
- The main process resolves contributions only from the activated, version-locked plugin host.
- Every summary action uses the current server-resolved actor and its permission.
- Dashboard reads remain read-only database transactions and create no audit mutation.
- Errors are serialized through the existing redacted IPC error boundary.

## Compatibility

- All eight standard templates must produce at least one accessible dashboard section for the administrator role.
- Composite templates may show multiple sections, sorted deterministically.
- Existing blueprint KPI definitions remain valid and continue to render.
- A pack without a dashboard contribution still receives KPI and business-entry bands.
- Legacy demo generation is unchanged.

## Testing And Acceptance

Unit and integration coverage must prove:

- contribution validation rejects unknown actions, actions that reject the strict empty payload, missing keys, negative or non-finite values, duplicate IDs, and unknown modules;
- unauthorized sections are omitted while authorized sections execute exactly once;
- the five core summary actions normalize into the expected status and attention items;
- all eight template combinations produce deterministic snapshots;
- the renderer shows nonzero attention items and shows the empty state only when every accessible attention item is zero;
- clicking a declared item navigates to the correct module;
- loading, retry, error, zero, narrow-width, and long-label states remain coherent;
- no generic domain action escape hatch is added to the dashboard API.

Packaged acceptance must capture the dashboard for representative inspection, inventory, and project templates. The project fixture must visibly reconcile pending task and deliverable counts with the attention list, eliminating the current contradictory empty message.

## Delivery Impact

The change affects domain UI descriptors, dashboard service composition, shared dashboard DTOs, the existing dashboard IPC response, renderer state and layout, screenshot expectations, and representative packaged acceptance. It does not alter database migrations or the generated business data model.
