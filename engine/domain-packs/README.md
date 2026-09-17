# Domain Pack Composer

This package defines and composes versioned domain-pack catalogs and blueprint fragments. It is the protocol/composer foundation for the six production domain packs; those business implementations are separate tasks.

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

## Current Scope

`tests/fixtures/packs/asset-provider` is a protocol fixture, not a production domain pack. The six production packs will be implemented and acceptance-tested in subsequent plans.
