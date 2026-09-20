# Desktop Business Runtime

This package is the reusable Electron + React + SQLite runtime for validated business blueprints. It is developed independently from the legacy `engine/template` application until the generator integration phase switches templates.

## Requirements

- Windows 10 or 11 x64
- Node.js 22.12 or later for development
- npm

The packaged application includes Electron and does not require a system browser, Node.js, a development server, or network access.

## Commands

Run from `engine/desktop-runtime`:

```powershell
npm ci
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm run dist:win
```

Build and verify the asset inspection reference application:

```powershell
npm run build:reference
npm run test:e2e:reference
# Generate four digests separately: set RZ_PASSWORD, then run node tools/hash-password.cjs.
$env:RZ_REFERENCE_DISPATCHER_PASSWORD_DIGEST = '<scrypt digest>'
$env:RZ_REFERENCE_OPERATOR_PASSWORD_DIGEST = '<scrypt digest>'
$env:RZ_REFERENCE_REVIEWER_PASSWORD_DIGEST = '<scrypt digest>'
$env:RZ_REFERENCE_ADMINISTRATOR_PASSWORD_DIGEST = '<scrypt digest>'
npm run dist:win:reference
node tools/verify-package.cjs --unpacked (Resolve-Path '.\dist\installers\win-unpacked').Path
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tools\verify-installer.ps1' `
  -InstallerPath (Resolve-Path '.\dist\installers\资产巡检整改管理软件 V1.0.0 安装包.exe').Path
node tools/write-acceptance-report.cjs --domain-unit 63 --domain-integration 157 `
  --combinations 8 --desktop-unit 32 --desktop-integration 34 `
  --restart passed --package passed --installer passed
```

The reference E2E runner generates four high-entropy passwords in memory and exposes them only to its child build and Playwright processes. Reference resources contain scrypt digests, never plaintext passwords.
`build:reference` may use the checked-in fixture digests for deterministic tests. `build:reference:release` and `dist:win:reference` fail closed unless all four external release digests are present; those digests must correspond to passwords delivered through a separate secure channel.

Validate an unpacked package:

```powershell
node tools/verify-package.cjs --unpacked (Resolve-Path '.\dist\installers\win-unpacked').Path
```

Validate the installer lifecycle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tools\verify-installer.ps1' `
  -InstallerPath (Resolve-Path '.\dist\installers\离线任务协同管理软件 V1.0.0 安装包.exe').Path
```

The reference application has 12 business views plus the data/backup view, four composite demonstration roles, 1000 deterministic business rows, and an asset -> inspection -> rectification work-order closure flow. See [the acceptance record](../../docs/reference-application-acceptance.md).

## Runtime Boundary

- The renderer has no Node.js or SQLite access.
- `contextIsolation` and the Chromium sandbox remain enabled.
- The preload bridge exposes named business operations only; there is no generic IPC method.
- The main process validates requests, resolves the actor from the session, checks permissions and performs transactions.
- Blueprint data cannot contain scripts, SQL or dynamic expressions.
- User data is stored under Electron's per-user `userData` directory, outside the installation directory.

## Blueprint Resources

`fixtures/runtime-blueprint.json` is a plugin-free acceptance blueprint. The build copies it, the seed and a SHA-256 resource manifest into `dist/resources`. At startup the main process verifies the blueprint bytes before opening the business database.

The fixture users exist only for automated acceptance testing:

- `dispatcher` / `Dispatch123!`
- `operator` / `Operator123!`
- `reviewer` / `Review123!`

Only scrypt digests are stored in `runtime-seed.json`. A generated production project must replace these fixture identities through the later generator integration flow; they are not production defaults.

## Backup and Restore

Backups use SQLite's consistent backup API and include a JSON manifest with application ID, application version, schema version, file size and SHA-256 digest. Restore requires permission and explicit application-ID confirmation. The service protects the current database before replacement and restores it if reopen, integrity or migration validation fails.

The live database and backups are stored under Electron's per-user `userData` directory, outside the installation directory. Uninstall leaves user data intact. Upgrades must preserve the application ID, apply forward-only migrations, and verify `project.lock.json` and the resource manifest before opening the database.

## Test Isolation

Integration tests use temporary SQLite files. Electron tests set an isolated `RZ_RUNTIME_USER_DATA` directory and remove it from Playwright global teardown after the worker exits. Build output, Playwright reports, temporary databases and installers are ignored by Git.
