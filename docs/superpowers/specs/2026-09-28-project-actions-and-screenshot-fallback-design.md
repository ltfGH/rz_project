# Project Actions and Screenshot Fallback Design

## Goal

Make `project_task_management` and `project_delivery_archive` usable from the packaged Electron UI and allow standard screenshot capture to prove a real permitted project action when those blueprints intentionally contain no generic workflow descriptors.

The fix must not add fake workflows, bypass screenshot evidence, or move domain validation into the renderer.

## Existing Failure

The project pack exposes fixed domain actions and transactional services, but `DomainActions` only renders asset, inspection, and work-order actions. `ModuleScreen` also exposes generic create/edit only for modules declaring generic `create` or `update`; project entities are system-managed and instead declare actions such as `create_project`, `create_task`, and `create_risk`.

The screenshot planner assumes every template has at least one generic blueprint workflow. Project templates have no generic workflows because their lifecycle is implemented by domain services, so screenshot planning fails before Electron starts.

## Architecture

### Project Action Form Registry

Add a renderer-owned, declarative action form registry adjacent to `DomainActions`. Each entry defines:

- stable domain action ID;
- display label;
- whether it is module-level or record-level;
- typed fields (`text`, `number`, `date`, `select`, `boolean`);
- a request builder that combines validated form values with record ID/version when required.

The registry is presentation glue only. It does not decide whether an action is allowed. Actions continue to come from runtime metadata filtered by the authenticated role, and the main-process domain command remains authoritative for state, identity, optimistic version, permission, and transaction checks.

### Supported Project Actions

Module-level forms:

- `project.create`;

Record-level forms:

- project: update, activate, request close, reject close, approve close;
- milestone: create from a project and complete a milestone;
- task: create from a project, update pending task, start, add progress, submit, reject, approve, cancel, restore;
- risk: create from a project, mitigate, close, reopen;
- deliverable: submit from a project and review a submitted delivery.

Read-only summary/dashboard commands remain read-only views and are not rendered as mutation buttons.

Project-child creation commands use the selected project record as `projectId`. Record actions use the selected record ID and optimistic `version`. Optional milestone references are entered as codes. Boolean and numeric values are converted before IPC invocation; dates use `YYYY-MM-DD` values without timezone conversion.

### Module-Level Actions

`ModuleScreen` renders module-level actions near the section heading. `project.create` opens its form without requiring a selected row. Successful completion closes the form and reloads the current page.

Record-level actions stay inside the detail drawer. Successful completion reloads both the selected record and the list. Errors remain redacted and user-facing; raw stack traces or request payloads are not displayed.

### Screenshot Planning

`Get-StandardScreenshotPlan` keeps generic workflow transitions as its first choice. When no workflow exists, it selects a non-CRUD module action that has:

- a known domain action mapping;
- a matching permission on a composite `operations_*` role;
- a renderer form/control definition.

The planned action contains stable module ID, domain action ID, action label, action type, and role ID. The Electron capture process logs in as that role, opens an eligible record when required, and verifies the exact action button is visible before capturing. Module-level actions are verified directly on the module page.

An action screenshot is accepted by materials only when the manifest records `controlVerified: true`, and existing executable/blueprint/image hash bindings remain mandatory.

## Data and Security Boundaries

- No schema, migration, permission, command, state, or transaction changes.
- No generic IPC channel or renderer-supplied actor identity.
- No plaintext password persistence.
- No model-generated action definitions or request builders.
- Domain errors remain structured and redacted.
- Theme aliases affect visible module/entity labels but never stable action IDs.

## Testing

1. Unit-test the project action registry: scope, labels, typed conversion, base ID/version fields, and absence of unsupported commands.
2. Renderer-test module-level project creation and record-level project/task/risk/deliverable controls using runtime metadata.
3. PowerShell-test screenshot fallback for a no-workflow project blueprint, including role selection and exact domain action ID.
4. Node-test capture contract behavior for module-level and record-level actions.
5. Run desktop typecheck, unit tests, integration tests, and build.
6. Re-run the packaged `project_task_management` representative generation through screenshot, materials, installer verification, and publication.

## Compatibility

Existing asset, inspection, and work-order forms keep their current behavior. Workflow-based screenshot planning remains unchanged for templates that provide workflows. Legacy generation is unaffected.
