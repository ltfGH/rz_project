# Standard Business Generator Integration Design

**Date:** 2026-09-21

**Status:** Approved in conversation; pending implementation planning

## Objective

Connect the existing production domain-pack composer and Electron desktop runtime to the user-facing generator so that a user can enter a supported business theme, confirm a recommended template, provide four role passwords, and receive a tested offline Windows business application at approximately the same engineering scale as the reference application.

The integration must preserve the existing four-page generator as an explicitly selected legacy mode. It must never silently downgrade a standard business generation request to the legacy output.

## Product Boundary

The first integrated version supports eight controlled templates built only from production domain packs and declared bridges. A generated standard business application may vary its software name, purpose, industry terminology, visible aliases, seed labels, screenshots and materials. It may not let a model invent entity IDs, fields, migrations, SQL, permissions, state transitions, domain commands or cross-table transactions.

An unsupported or ambiguous theme is resolved through user template selection. It is not resolved by generating an arbitrary schema.

## Generation Modes

`开始生成.bat` continues to invoke `engine/Generate.ps1`. The script adds a mode selection before generation:

1. `StandardBusiness` - Electron + React + SQLite application assembled from production domain packs. This is the default when the user presses Enter.
2. `LegacyDemo` - the current four-route browser-storage demonstration application and its existing twelve-file delivery contract.

The old orchestration remains intact behind `LegacyDemo`. Standard mode uses a separate orchestrator and separate validation, screenshot, material and publishing contracts while reusing the current safe workspace, dependency preflight, logging, failure retention and atomic publication utilities.

There is no automatic fallback from `StandardBusiness` to `LegacyDemo`.

## Supported Templates

The template catalog is a version-controlled static resource. Every entry has an ID, display name, recommendation keywords, exact pack selections, role summary, primary entities, workflow summary and expected view range.

| Template ID | Display name | Production packs | Expected scope |
| --- | --- | --- | --- |
| `asset_inspection_rectification` | 资产巡检整改 | `asset_registry`, `inspection_rectification`, `work_order_service`, `asset_inspection_bridge`, `asset_work_order_bridge`, `inspection_work_order_bridge` | Reference-scale asset, inspection and rectification closure; about 12 business views plus maintenance |
| `asset_work_order_operations` | 资产工单运维 | `asset_registry`, `work_order_service`, `asset_work_order_bridge` | Asset service request and work-order lifecycle; about 7-9 business views |
| `asset_inspection_management` | 资产巡检管理 | `asset_registry`, `inspection_rectification`, `asset_inspection_bridge` | Asset plans, tasks, results and archive; about 7-9 business views |
| `inspection_rectification_orders` | 巡检整改工单 | `inspection_rectification`, `work_order_service`, `inspection_work_order_bridge` | Inspection abnormalities and rectification closure without asset registry; about 7-9 business views |
| `inventory_application_approval` | 库存申领审批 | `inventory_batch`, `application_archive`, `inventory_application_bridge` | Materials, warehouses, batches, approval and issue ledger; about 8-10 business views |
| `project_delivery_archive` | 项目交付归档 | `project_task`, `application_archive`, `project_archive_bridge` | Projects, milestones, tasks, risks, delivery versions and managed archive; about 8-10 business views |
| `project_task_management` | 项目任务管理 | `project_task` | Project, milestone, weighted task, risk and delivery management; about 6-8 business views |
| `application_approval_archive` | 申请审批归档 | `application_archive` | Multi-round approval, immutable file versions, certificates and reminders; about 6-8 business views |

The catalog does not expose arbitrary pack combinations. A combination is user-selectable only when its dependency graph, bridges, runtime descriptors and acceptance behavior are explicitly supported.

## Template Recommendation

`TemplateRecommender` is deterministic and does not call a model. It normalizes the theme, scores catalog entries from positive keyword groups and stable weights, and returns:

- one recommendation when one score is clearly highest;
- at most two candidates when the highest scores are tied or close;
- the full catalog when no entry reaches the minimum score.

The recommendation screen shows each candidate's match reason, primary entities, roles, workflow summary and expected page range. The user must confirm a template. The user can always open the full catalog and choose another supported template.

Broad themes such as “综合管理平台” do not select a template automatically.

## Interactive Flow

Standard mode has the following ordered interaction states:

1. Select generation mode; Enter selects `StandardBusiness`.
2. Enter a software theme.
3. Score and display one or two recommended templates, or all templates when unmatched.
4. Confirm the selected template.
5. Display the final summary: normalized software name, selected packs, primary entities, roles, main workflow and expected views.
6. Confirm generation.
7. Enter and confirm four hidden initial passwords.
8. Execute the standard business pipeline without further input.

The four account profiles are template-owned composite roles corresponding to business dispatch/administration, operation, review and system administration. Usernames remain stable and are documented in the generated operation manual. Passwords are never printed.

Non-interactive automation receives explicit `GenerationMode`, `TemplateId` and password-digest inputs. It must not wait for prompts.

## Password Handling

Interactive password entry uses PowerShell `Read-Host -AsSecureString`. Each password:

- contains at least 12 characters;
- includes uppercase, lowercase, number and special-character classes;
- differs from the other three role passwords;
- is entered twice and must match.

Plaintext is exposed from `SecureString` only for the shortest practical interval needed to derive a random-salt scrypt digest. References and buffers are cleared in `finally` blocks. Only digests enter the assembled seed resource.

Plaintext passwords are excluded from logs, errors, blueprints, locks, manifests, reports, screenshots, source archives, installers and complete delivery archives. The generator does not create a plaintext password handoff file. The generator operator is responsible for retaining and separately delivering the passwords entered.

Release builds continue to fail closed if all four required digests are not present.

## Theme Presentation Profile

After template confirmation, Codex may produce one strict theme presentation profile. Its schema permits only:

```text
softwareName
purpose
industry
entityAliases
moduleAliases
seedVocabulary
```

Constraints include:

- strict object schemas with no unknown properties;
- bounded keys selected from the chosen template's declared aliasable IDs;
- bounded string and array lengths;
- plain text only;
- no HTML, Markdown links, filesystem paths, URLs, scripts, SQL, commands, expressions or executable-looking keys;
- no identity, applicant, credential or publication fields.

The profile is validated before use and deeply frozen. A single Codex repair attempt is permitted for a schema-invalid profile. A second failure stops generation.

The profile affects display names, documentation wording and synthetic seed labels only. Stable IDs, database tables, fields, relations, permissions, workflows, migrations, runtime actions, bridge commands and transaction boundaries remain unchanged.

## Standard Business Orchestrator

`StandardBusinessOrchestrator` owns the new pipeline and records every stage in the existing generation log:

1. `RecommendTemplate`
2. `CollectCredentials`
3. `BuildThemeProfile`
4. `ComposeDomain`
5. `AssembleResources`
6. `BuildDesktop`
7. `VerifyDomain`
8. `VerifyPackagedWorkflow`
9. `CaptureDesktopScreenshots`
10. `BuildBusinessMaterials`
11. `BuildWindowsInstaller`
12. `VerifyInstaller`
13. `PackageBusinessDelivery`
14. `Publish`

It invokes existing production paths rather than copying reference artifacts:

- domain-pack CLI for `blueprint.json`, `domain-lock.json` and composition evidence;
- deterministic seed builders with template-specific record counts totaling approximately 1000 counted business rows;
- project-lock and resource-manifest builders;
- production runtime catalog bundle;
- desktop runtime TypeScript/Vite build;
- electron-builder NSIS packaging;
- packaged Playwright workflow and restart verification;
- isolated installer lifecycle verification.

Every standard-mode output has its own isolated workspace. Failed workspaces are retained after creation. A successful workspace is removed unless the existing keep-workspace option is set.

## Blueprint and Resource Assembly

The selected template supplies exact pack IDs, exact versions and validated pack configuration. The assembler:

- composes the production blueprint;
- applies only schema-validated presentation aliases;
- appends the maintenance module and template composite roles;
- validates the final blueprint again;
- creates deterministic synthetic records and injected password digests;
- writes `project.lock.json` with generator, runtime, Electron, Node, SQLite, pack and target versions;
- bundles the production runtime catalog;
- writes a SHA-256 resource manifest;
- publishes resources through sibling staging and atomic rename.

Aliases change labels, never stable IDs. Locks and manifests cover the final aliased blueprint bytes.

## Verification

Standard mode publishes no delivery when any required check fails. Required checks include:

- template catalog and recommendation tests;
- theme-profile hostile-input and schema tests;
- all selected domain-pack composition and runtime tests;
- entity-reference, role-permission, state and seed integrity;
- password-leak scan over logs, resources and deliverables;
- desktop typecheck, unit and integration tests;
- packaged application launch with four roles;
- cross-domain workflow closure for every bridge in the selected template;
- negative permission and lifecycle-blocker behavior;
- direct SQLite state, relation, event and audit assertions after shutdown;
- restart persistence visible through the UI;
- unpacked package resource and credential checks;
- isolated NSIS install, self-check, uninstall and user-data preservation.

At minimum, the asset-inspection-rectification, inventory-application-approval and project-delivery-archive templates receive full packaged end-to-end workflows. The remaining templates receive composition/runtime acceptance plus a shared packaged smoke and persistence workflow. All eight templates must assemble deterministically for identical non-secret inputs and supplied digests.

## Screenshot and Material Generation

Standard-mode screenshots come from the packaged Electron executable and the final blueprint. The screenshot plan selects the dashboard and representative list/detail/action states from metadata. It does not reuse the legacy four HTML routes.

Materials are generated from the final locked blueprint, template metadata, presentation profile, packaged screenshots and verification evidence. They must describe only implemented modules, roles, workflows, storage and runtime requirements.

Applicant identity, contact, ownership and publication facts remain applicant-supplied. The application form retains both `【申请人填写】` and `【生成时按实际源码统计填写】` until the applicant completes them.

## Standard Delivery Contract

Standard mode uses a new flat delivery contract. It retains the familiar installer, manuals, source materials, application form, environment document, prototype document, source archive, validation report and complete archive. It additionally includes:

- `业务蓝图.json`
- `领域版本锁.json`
- `验收报告.json`

The complete delivery ZIP contains every other standard-mode delivery file. Its exact count is derived from the standard contract rather than the legacy fixed count of twelve.

The validation report records software/version IDs and high-level results but contains no password, token, absolute local path or applicant identity.

## Failure Behavior

- Unmatched themes display all eight templates.
- Invalid passwords keep the user in credential collection and create no project resources.
- Invalid theme profiles receive one repair attempt, then fail.
- Composition, resource, build, E2E, persistence, screenshot, material, installer or receipt failures stop publication.
- Standard mode never falls back to legacy mode.
- Failure messages identify the stage and a redacted reason.
- Existing workspaces are retained on failure; pre-workspace failures provide only the log path.
- Existing delivery directories are not overwritten; the current timestamp/counter suffix behavior is preserved.

## Compatibility

`LegacyDemo` preserves the current prompt-independent command behavior when explicitly requested and continues to satisfy its four routes and twelve-file contract. Current legacy tests remain unchanged except for mode-routing coverage.

Shared dependency preflight, safe-path checks, logs and publication primitives may be extracted only when both orchestrators use the same semantics. Standard-mode requirements must not weaken legacy isolation or validation.

## Acceptance Criteria

The integration is complete when:

1. The default interactive path is standard business mode.
2. All eight catalog templates are selectable and deterministic.
3. Keyword recommendation covers a clear match, close tie and no-match case.
4. The user confirms the template and generation summary before any credentials or workspace resources are created.
5. Password rules, uniqueness, hashing and leak scans pass.
6. Theme presentation changes terminology without changing stable domain behavior.
7. Every template produces a runnable packaged Electron application with valid locks and about 1000 counted business rows.
8. The three composite reference workflows pass full packaged end-to-end, SQLite and restart checks.
9. The remaining five templates pass packaged smoke/persistence plus production runtime acceptance.
10. Screenshots and materials describe the actual final application.
11. The installer passes isolated install, self-check and uninstall while preserving user data.
12. The standard delivery includes blueprint, domain lock and acceptance evidence without secrets.
13. Explicit legacy mode remains behaviorally compatible and fully green.

## Non-Goals

- Arbitrary model-generated schemas or SQL
- A visual drag-and-drop low-code designer
- Runtime editing of state machines or permissions
- Automatic applicant, ownership or publication information
- Cloud deployment, multi-tenant services or external integrations
- Combining production packs without a declared and tested bridge
- Silent fallback to a smaller legacy application
