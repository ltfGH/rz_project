# Domain Pack Composer

This package defines and composes versioned domain-pack catalogs, blueprint fragments and constrained runtime extensions. It is the protocol/composer foundation for production domain packs.

## Commands

Run from `engine/domain-packs`:

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

`npm run build` generates the checked-in, self-contained `bin/domain-pack-cli.cjs`. It bundles Zod and runs without this package's `node_modules`.

## CLI

```powershell
node bin/domain-pack-cli.cjs --request <absolute-request.json> --output <absolute-output-directory>
```

The request envelope contains explicit absolute pack roots and a strict `composition` request. The composer never scans arbitrary directories.

Successful output contains:

- `blueprint.json`
- `domain-lock.json`
- `composition-report.json`

The files use canonical JSON and are published through a sibling staging directory followed by atomic rename. Blocked compositions return exit code `1` and do not publish artifacts. Invocation or filesystem failures return exit code `2`.

## Security Boundary

- Pack roots and entrypoints must be regular, non-reparse files under explicit absolute roots.
- Catalog and fragment JSON are capped at 5 MiB.
- Fragments cannot contain scripts, SQL, commands, expressions or executable declarations.
- Dependencies require unique capability providers and an acyclic allowed graph.
- Objects have one owner; extensions require a public extension point.
- Merge conflicts never use last-write-wins behavior.
- The final blueprint must pass the existing blueprint validator.

## Production Packs

- `packs/asset_registry`: production asset registry pack with four related entities, an explicit lifecycle service, responsibility history, deterministic seed data, constrained UI descriptors and a real-SQLite acceptance scenario. See [asset_registry/README.md](packs/asset_registry/README.md).
- `packs/work_order_service`: standalone production work-order pack with service catalogs, fixed SLA deadlines, dispatch/handling/review separation, append-only events, deterministic seed data and a real-SQLite acceptance scenario. See [work_order_service/README.md](packs/work_order_service/README.md).
- `packs/inspection_rectification`: standalone production inspection pack with controlled plans, dual-version item execution, abnormal disposition, review/archive blockers, deterministic seeds and a real-SQLite acceptance scenario. See [inspection_rectification/README.md](packs/inspection_rectification/README.md).
- `packs/inventory_batch`: standalone production inventory pack with material and warehouse configuration, optimistic batch balances, append-only movements, expiry reporting, deterministic seeds and a real-SQLite acceptance scenario. See [inventory_batch/README.md](packs/inventory_batch/README.md).
- `packs/project_task`: standalone production project pack with weighted task progress, milestone and delivery gates, risk controls, independent closure review, deterministic seeds and a real-SQLite acceptance scenario. See [project_task/README.md](packs/project_task/README.md).
- `packs/application_archive`: production application/archive pack with multi-round sequential approval, managed immutable files, recoverable imports, certificate renewal, in-app expiry reminders and real filesystem acceptance. See [application_archive/README.md](packs/application_archive/README.md).
- `packs/domain_document_bridge`: optional production bridge that links domain documents to application/archive extension points and registers a typed approval-completion command.

Everything under `tests/fixtures/packs` remains protocol or composition test data and must not be used as a production pack. Additional planned production packs and optional cross-pack bridges are implemented in later work units.
