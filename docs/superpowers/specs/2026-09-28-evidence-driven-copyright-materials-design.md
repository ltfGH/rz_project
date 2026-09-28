# Evidence-Driven Copyright Materials Design

## Goal

Replace the standard generator's placeholder documents with a reusable, evidence-driven material system that produces Demo-scale software copyright delivery materials for all eight supported templates.

The generated software remains the source of truth. Materials may explain and format verified facts, but may not invent modules, commands, workflows, database structures, applicant facts, external integrations, or performance claims.

## Scope

This design applies to all eight `StandardBusiness` templates. `LegacyDemo` keeps its existing twelve-file behavior.

The standard delivery contract grows from fifteen to eighteen flat files by adding:

- `软件名-软件简介.docx`
- `软件名-功能表.docx`
- `软件名-数据库设计.docx`

No MP4 videos are generated. Demo videos, plaintext passwords, local paths, and applicant-specific identity are not copied.

## Architecture

### MaterialFacts Boundary

Introduce a versioned `MaterialFacts` object as the only input accepted by standard material renderers. It is assembled from:

- final locked blueprint;
- activated domain action metadata and composite role permissions;
- compiled SQLite schema, indexes, foreign keys, and migrations;
- deterministic seed report;
- packaged workflow and persistence receipts;
- screenshot manifest and image hashes;
- project lock and runtime versions;
- theme presentation profile;
- source manifest and source hashes.

`MaterialFacts` contains no plaintext credentials, applicant identity, local absolute paths, or unverified model output. Every field records or implies a stable evidence source. Unknown applicant and filing facts remain explicit placeholders.

The data flow is:

```text
locked resources + schema + commands + receipts + screenshots + source manifest
                                  |
                                  v
                         MaterialFacts validator
                                  |
          +-----------------------+-----------------------+
          v                       v                       v
   deterministic text       diagrams/tables        fixed Word templates
          |                       |                       |
          +-----------------------+-----------------------+
                                  v
                         DOCX/PDF quality gates
                                  |
                                  v
                       atomic delivery publication
```

### Model Boundary

The model may polish short narrative sections only after `MaterialFacts` is complete. Its response is schema-validated and limited to fixed section IDs. The model cannot add facts, module IDs, action IDs, numbers, environment versions, database names, applicant identity, or integrations.

If narrative generation fails, deterministic Chinese text generated from `MaterialFacts` is used. Layout, required sections, tables, screenshots, diagrams, and quality gates never depend on the model.

## MaterialFacts Content

The contract includes:

- software: name, version, purpose, industry, boundaries, build date;
- modules: display name, purpose, visible fields, supported operations, validation notes;
- roles: display name and verified visible operations;
- workflows: domain-command flows as well as generic blueprint workflows;
- commands: fixed input labels, preconditions, result states, and owning module;
- database: business/system tables, columns, types, nullability, defaults, primary keys, unique constraints, foreign keys, indexes, and relationships;
- runtime: Windows target, Electron/Node/SQLite versions, user-data location policy, backup/restore behavior, offline boundary;
- screenshots: role, module, operation, before/after state, caption, executable hash, blueprint hash, and image hash;
- source: selected files, total files, total lines, selected print lines, and canonical digest;
- evidence: build, package, workflow, installer, persistence, screenshot, and material receipts.

Project templates derive their workflow descriptions from fixed domain actions because they intentionally do not use generic blueprint workflow descriptors.

## Applicant Form

Standard mode reuses `engine/template/materials/application-form-template.docx` and the existing bookmark-based exporter instead of opening generic HTML as a document.

The form has nineteen stable fields and must remain exactly two pages. Automatically populated facts include software name, version, real development purpose, industry, Electron/SQLite environment, programming languages, verified main functions, technical characteristics, and source-line evidence.

Software abbreviation, classification number, completion date, organization date, and other unknowable fields present in the nineteen-field template remain `【申请人填写】`. Source quantity retains `【生成时按实际源码统计填写】` next to the measured value for applicant verification. Applicant identity, ownership, and publication facts are outside this software-information template; the generated checklist explicitly states that they still require applicant completion on the current official filing form.

The unit/organization name used on other covers is also `【申请人填写】`; the generator does not prompt for or infer it.

## Document Set

### Software Introduction

Three to five pages containing purpose, intended users, business scope, module overview, complete workflow summary, data characteristics, technical architecture, offline boundary, and implemented/non-implemented capability statements.

### Feature Table

Six to ten pages of structured tables. Each module lists user-visible operations, inputs, result, role, and verification rule. Internal IDs such as `project.create`, `list`, and `view` never appear in display text.

### Operation Manual

Fifteen to twenty-five pages with:

- cover and document information;
- installation and first launch;
- login and four roles;
- navigation and shared list/detail behavior;
- one section per core module;
- field descriptions and validation rules;
- at least one complete business flow;
- backup and restore;
- common errors, uninstall, and data retention;
- twelve to eighteen non-duplicate screenshots.

Each core operation section describes prerequisites, numbered steps, expected result, and failure behavior.

### Database Design

Twelve to twenty pages generated from the compiled SQLite schema. It contains database purpose, storage policy, entity relationship diagram, business/system table classification, core table dictionaries, keys, constraints, foreign keys, indexes, state fields, transaction boundaries, seed strategy, schema versioning, backup, and restore.

No table, field, index, or relation may be described unless it exists in the compiled schema.

### Runtime Environment

Three to five pages covering Windows architecture, installer behavior, minimum window, embedded runtime, local data policy, backup/export locations, offline behavior, hardware guidance without unsupported performance claims, build versions, install, launch, uninstall, and data retention.

### Prototype Design

Contains purpose-built diagrams rather than reusing ordinary screenshots:

- navigation hierarchy;
- representative list/detail/form wireframes;
- role-operation matrix;
- business flow diagram;
- entity relationship overview.

Bitmap screenshots may supplement these diagrams but cannot replace them.

### Source Material

The source DOCX/PDF and source ZIP share one canonical manifest.

- If formatted source is at most sixty pages, include all pages.
- If it exceeds sixty pages, include the first thirty and last thirty pages.
- Use approximately fifty source lines per page with stable font, margins, header, software name, version, and page number.
- Include application runtime and selected production packs.
- Exclude dependencies, build outputs, databases, logs, test results, temporary files, and machine paths.

The final DOCX and PDF page counts are verified after saving, not inferred from the source HTML.

## Screenshot Evidence

Each template produces a bounded plan of twelve to eighteen screenshots derived from its modules and complete business flow:

- login;
- dashboard;
- core module lists;
- representative detail;
- create/action form;
- post-action state;
- major workflow checkpoints;
- backup/restore;
- minimum-window or mobile-width view.

For `project_task_management`, screenshots cover project creation and activation, milestone creation, task start/progress/submission/review, risk handling, deliverable submission/review, project close request/review, and backup.

The manifest binds every image to role, stable module ID, command ID, before/after state, executable hash, blueprint hash, and image hash. Material captions use Chinese display names only.

Quality checks reject blank images, missing controls, incoherent overlap, duplicate or near-duplicate images, mismatched before/after states, and images from another executable or blueprint.

## Eighteen-File Standard Delivery Contract

1. `软件名 V1.0.0 安装包.exe`
2. `软件名-操作手册.docx`
3. `软件名-操作手册.pdf`
4. `软件名-源码.docx`
5. `软件名-源码.pdf`
6. `软件名-申请表.docx`
7. `软件名-申请表.pdf`
8. `软件名-运行环境.docx`
9. `软件名-原型设计图.docx`
10. `软件名-软件简介.docx`
11. `软件名-功能表.docx`
12. `软件名-数据库设计.docx`
13. `软件名-项目源码.zip`
14. `业务蓝图.json`
15. `领域版本锁.json`
16. `验收报告.json`
17. `校验报告.txt`
18. `软件名-完整交付包.zip`

The complete ZIP contains the other seventeen files.

## Quality Gates

Publication requires all of the following:

- applicant form: exactly two pages, expected tables, all nineteen bookmarks/fields, both applicant/source markers;
- introduction: three to five pages, at least 1,200 non-whitespace Chinese/Latin characters, and every selected core module named;
- feature table: six to ten pages, at least 2,500 non-whitespace characters, and at least one table section per selected core module;
- manual: fifteen to twenty-five pages, at least 3,000 non-whitespace characters, twelve to eighteen embedded screenshots, one complete numbered workflow, and no internal IDs;
- database design: twelve to twenty pages, at least 3,500 non-whitespace characters, an overview/relationship diagram, and at least one field table per core business entity;
- runtime environment: three to five pages, at least 800 non-whitespace characters, and at least two environment/installation tables;
- prototype: six to twelve pages, navigation, list/detail/form, role matrix, workflow, and relationship diagrams, with at least five embedded diagram images;
- screenshots: count, dimensions, nonblank pixels, visible target controls, perceptual difference threshold, hashes;
- source: canonical file digest, selected-line digest, forty-five to fifty-five source lines per page, sixty-page selection rule, headers, page numbers, readable DOCX/PDF;
- all documents: consistent software name/version, no secrets, tokens, applicant fabrication, local paths, unsupported claims, or temporary files;
- complete delivery: exact eighteen flat regular files and readable seventeen-entry ZIP.

Page and media checks are performed on the final saved DOCX/PDF files through Word/PDF inspection. File existence alone is never sufficient.

## Failure and Publication

All outputs are built under an isolated material staging directory. Any fact validation, screenshot, narrative, Word export, page count, table count, media, duplicate image, source, or content scan failure removes the material staging directory and stops publication. Failed project workspaces remain for diagnosis, with redacted issue summaries in the generation log.

Only a completely verified material set is copied into standard delivery staging. Existing delivery directories retain timestamp/counter collision behavior and are never overwritten.

## Testing Strategy

- Contract tests for `MaterialFacts` across all eight templates.
- Hostile-input and unsupported-claim tests.
- Applicant-form bookmark, table, and two-page tests.
- Per-document section, word, page, table, and media tests.
- Screenshot pixel, dimension, hash, duplicate, control, and before/after-state tests.
- Compiled-schema-to-database-document coverage tests.
- Source-manifest and final sixty-page rule tests.
- Truthfulness tests ensuring selected modules appear and unselected modules do not.
- Full workflow screenshot/material acceptance for asset inspection remediation, inventory approval, and project task management.
- One representative Windows installer and eighteen-file end-to-end delivery acceptance.
- Legacy twelve-file delivery regression tests.

## Migration

The existing fifteen-file standard contract is replaced atomically; there is no mixed compatibility mode. Documentation and validation reports state the new eighteen-file contract. Previously generated deliveries remain unchanged and are not silently rewritten.
