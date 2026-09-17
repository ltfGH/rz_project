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

Validate an unpacked package:

```powershell
node tools/verify-package.cjs --unpacked (Resolve-Path '.\dist\installers\win-unpacked').Path
```

Validate the installer lifecycle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tools\verify-installer.ps1' `
  -InstallerPath (Resolve-Path '.\dist\installers\离线任务协同管理软件 V1.0.0 安装包.exe').Path
```

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

## Test Isolation

Integration tests use temporary SQLite files. Electron tests set an isolated `RZ_RUNTIME_USER_DATA` directory and remove it from Playwright global teardown after the worker exits. Build output, Playwright reports, temporary databases and installers are ignored by Git.
