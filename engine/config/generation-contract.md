# Generated project contract

Codex may modify only these files inside the current isolated workspace:

- app/index.html
- app/assets/styles.css
- app/js/domain.js
- app/js/demo-data.js
- app/js/storage.js
- app/js/app.js
- app/tests/domain.test.js
- app/tests/storage.test.js
- app/tests/ui-contract.test.js
- materials/content/manual.html
- materials/content/application-info.html
- materials/content/runtime.html
- materials/content/prototype.html

Do not create, delete, read, or modify any other file or directory.

The application must retain exactly four hash routes: `#dashboard`, `#records`,
`#operation`, and `#history`. Retain the fixed page containers for those routes.
Theme the visible application name, business fields, core business operation, and
demo data for the requested software. Implement add, edit, delete, search, local
browser storage, a dashboard, and one theme-specific core operation. The layout
must work on mobile screens.

Use only offline local assets. Do not use network access, `fetch`, XHR,
`XMLHttpRequest`, `WebSocket`, external scripts, or CDNs. Do not add a server,
database, login, account, or remote service. Applicant identity, certificate,
credit-code, contact, and publication information must remain marked for the
applicant to fill in; do not invent personal information.

The generated software is an offline demonstration application. Its runtime
material must state that data is stored in local browser storage and include the
exact phrase `无需外部数据库`. Do not claim that MySQL, MariaDB, PostgreSQL,
SQL Server, Oracle, or another external database is installed, connected, or
required. If the prototype describes tables, entity relationships, or a database
diagram, label that section `逻辑数据模型` and make clear that it represents the
business data structure rather than an external database deployment.

`materials/content/application-info.html` is the application form and must keep
one compact bordered table with exactly 16 `tr` rows. Preserve the two vertically
merged section cells for software basic information and software functions and
technical characteristics, together with `rowspan` and `colspan` attributes.
Preserve every existing English `data-field` attribute because the Word exporter
uses those stable identifiers to place generated values into the sample template.
Keep the sample-compatible field order: software name/version, abbreviation and
classification number, completion/company dates, software category, development
and runtime hardware, development OS/tools, runtime platform/support software,
programming language/source quantity, development purpose, target industry, main
functions, and technical characteristics. Tailor truthful software fields to the
generated application, keep unknown applicant-supplied values marked
`【申请人填写】`, and keep the main-function description concise enough for a
two-page Word form. Do not replace the form with a simple two-column information
list and do not add applicant identity or contact details that are absent from the
sample form.

Before finishing, run:

```text
node --test app/tests/domain.test.js app/tests/storage.test.js app/tests/ui-contract.test.js
```
