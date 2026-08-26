# Provider Authoring UX

> **Status:** executable provider authoring UX for `GLA-110.08`, promoted from the `GLA-107.11` UX
> specification.
> **Scope:** the developer/operator-agent experience for creating a provider package or template package that is
> complete, testable, reviewable, and ready to hand off to the operator install/update flow. This is a distinct UX
> flow from operator install/update and runtime consumption. Permissions are constraints inside the journey, not the
> journey structure.

## 1. Protagonist And Job

The protagonist is a provider author: either a developer or an operator's agent acting in a development workspace on
the operator's behalf. Their job is to produce a package that a reviewer can understand and an operator can install
without guessing the missing pieces.

The author is not trying to run a live session, change deployment/template selection, mark a provider available, or
mutate a running daemon. Those belong to later flows. The authoring UX answers one question:

> Can I create a provider package or template package whose manifest, schemas, diagnostics, docs, and tests prove it
> is complete enough to enter the trusted install/update path?

## 2. Entry Points

The tooling surface is command-first because provider authors work in a repository and need generated package data,
tests, and validation output. The current executable `gla` CLI exposes a JSON-first authoring flow: scaffold commands
emit an authoring JSON skeleton to stdout, and validate/test/inspect commands read that JSON from a file. A UI may wrap
these commands later, but it should preserve the same state model and diagnostics.

| Entry point | Purpose | Primary output |
|---|---|---|
| `gla provider scaffold --family <family> --id <provider-id> [--version <version>] [--summary <text>]` | Start a runtime provider package for a known family. | JSON skeleton with `ProviderManifest`, module evidence, docs, contract test refs, changed files, and WPM skeleton refs. |
| `gla template-package scaffold --id <package-id> [--template <template-id>] [--launcher <id>] [--entrypoint <id>] [--connector <id>] [--workspace <id>] [--detector <id>] [--open-parts <parts>] [--version <version>] [--summary <text>]` | Start a catalog `TemplatePackage`. | JSON skeleton with `TemplatePackage`, `CapsuleTemplate`, `template.<id>` defaults, compatibility stubs, docs, and tests. |
| `gla provider validate <path>` | Validate a provider package or local authoring bundle before code review. | Stable diagnostics grouped by manifest, schema, probe, skills/docs, dependencies, redaction, duplicate ids/versions, and tests. |
| `gla template-package validate <path>` | Validate catalog-only template package completeness. | Stable diagnostics proving consumed defaults/compatibility fields and no executable runtime provider factory. |
| `gla provider test <path>` | Run local provider authoring contract preflight. | Test report with validation-backed pass/fail status, declared contract-test refs, and diagnostics. Package test files are declared for review; this command does not execute external test runners. |
| `gla template-package test <path>` | Run local template-package authoring contract preflight. | Test report with validation-backed pass/fail status, declared contract-test refs, and diagnostics. Package test files are declared for review; this command does not execute external test runners. |
| `gla provider inspect <path>` | Show the package as the operator/reviewer will see it. | Read-only summary of family, capabilities, schemas, requirements, skills/docs, tests, and handoff readiness. |
| `gla template-package inspect <path>` | Show template-package reviewer/operator readiness. | Read-only summary of package id, template ids, defaults, compatibility, docs/tests, and handoff readiness. |

These command names match the current executable CLI contract. Future command names must be marked as deferred or
future before appearing in this executable flow. The UX contract is fixed: scaffold, validate, test, inspect, then
hand off.

## 3. Package Inputs

### ProviderPackage

A runtime provider package is complete only when the author supplies:

- `ProviderManifest` with `apiVersion`, `kind`, `metadata.name`, `metadata.version`, `spec.family`, capability,
  config or factory schema, probe id, skills/docs, optional dependency requirements, and compatibility relations.
- Provider module code registered through the matching ProviderRegistry family method, with current internal
  ProviderHost mechanics hidden behind that boundary.
- Config and factory schemas that expose only the trusted author-approved option surface.
- Probe implementation or probe adapter proving current health and contract availability.
- Skills or docs that let an agent/operator use the provider without hidden implementation knowledge.
- Contract tests for manifest identity, schema validation, probe behavior, factory creation, redacted diagnostics,
  dependency behavior, compatibility declarations, and provider-owned state or assets when present.
- Optional WPM bundle source when the provider has host-touching dependencies.
- Optional provider-owned state schema and asset declarations, with sensitive/default classifications.

### TemplatePackage

A template package is catalog data, not a runtime provider factory. It is complete only when the author supplies:

- `TemplatePackage` metadata and package tests.
- One or more `CapsuleTemplate` manifests with required parts, open parts, schema/open params, defaults, and
  compatibility requirements.
- Skills or docs for the template.
- Tests proving the template resolves against registered providers and rejects fixed-part or incompatible overrides.
- No executable provider factory unless the same package also ships a separate runtime provider package.

## 4. Authoring Journey

1. **Choose the package kind.** The author selects a runtime provider family or a template package. The surface shows
   the family contract and the required artifact checklist before writing files.
2. **Scaffold.** The tool emits the package shape as JSON, failing if the provider/template id is malformed or the
   family is unknown. The JSON names package-local files only; it does not require edits to app deployment, capsule
   composition, gateway, session, identity, worker, route, completion, or kernel packages.
3. **Fill the manifest and schema.** The author supplies capabilities, config/factory schemas, relations, dependency
   requirements, and skills/docs. The surface validates as the author works and names exact missing fields.
4. **Implement package-owned behavior.** Runtime providers implement the family factory/probe/state/assets inside the
   package. Template packages author catalog entities only.
5. **Declare dependency intent.** Host-touching requirements are declared as dependency requirements and optional WPM
   bundle source. The UX explains that WPM receipts are produced later by operator install/update, not by authoring.
6. **Run local validation.** `validate` checks manifest shape, schema shape, canonical family ids, duplicate ids and
   versions, duplicate template ids, consumed default keys, compatibility relations, docs, redaction, dependency
   declarations, and no narrow-waist imports.
7. **Run contract preflight.** `test` runs the local authoring validation harness and reports declared contract-test
   refs. It does not execute provider package test files; package authors still run their package-local test runner
   before handoff.
8. **Inspect handoff readiness.** `inspect` shows a reviewer/operator summary: what the package provides, what it
   requires, how it is configured, which tests passed, and which WPM/operator steps remain.
9. **Hand off to operator install/update.** The output is a package path plus a readiness report. Selecting it in a
   deployment or capsule defaults, producing WPM receipts, applying install/update changes, and restarting the daemon
   are outside this flow.

## 5. States

| State | Author sees | Exit condition |
|---|---|---|
| `empty` | No package exists. | Scaffold command emits a JSON skeleton or stops on unsafe input. |
| `scaffolded` | JSON skeleton names package files and contract-test refs. | Required manifest/schema/docs/probe/test placeholders are filled in package source. |
| `incomplete` | Validation diagnostics name missing or invalid artifacts. | All blocking diagnostics are resolved. |
| `validating` | Checks are running with grouped progress. | Validation returns pass/fail with stable codes. |
| `contract-test-failed` | Test failures point at the package artifact and expected behavior. | Contract tests pass locally. |
| `ready-to-stage` | Readiness report says what the operator flow must install, select, and verify. | Package is handed to operator install/update. |

## 6. Diagnostics And Recovery

Diagnostics must be stable enough for an agent to repair the package and for a reviewer to recognize the defect.
Messages should name the package file, the field or test, and the next repair action. They must not echo raw secrets.

| Diagnostic area | Example defect | Recovery path |
|---|---|---|
| Missing manifest fields | `metadata.name`, `spec.family`, `capability`, or `probe` absent. | Fill the named field or rerun scaffold for the correct family. |
| Invalid schemas | Config schema has unknown field types, invalid enum/range, or conflicting requirements. | Fix the schema; rerun validation before changing runtime code. |
| Missing skills or docs | Provider/template ships no usage instructions. | Add a skill or docs entry that explains safe use from catalog output alone. |
| Missing probes | Runtime provider has no probe or the probe id does not resolve. | Add a probe stub and contract test; template packages do not add runtime provider probes. |
| Dependency requirements | Host-touching dependency is used but not declared. | Add `requires` and optional WPM bundle source; WPM receipts are produced in install/update. |
| Duplicate ids or versions | Provider id/version or template id appears more than once in a local bundle. | Rename or version the duplicate package before install/update can consume it. |
| Inert or unsupported fields | Template defaults use an unprefixed template id or compatibility uses unsupported keys such as `openParts`. | Use consumed fields such as `template.<template-id>` and `compatibility.requiredParts`. |
| Redaction failures | Diagnostic, manifest, state sample, asset, or test fixture contains raw secret material. | Replace literal values with `secretRef` or non-sensitive fixtures and rerun redaction tests. |
| Contract-test failures | Factory, manifest, probe, compatibility, asset, or state behavior disagrees with the contract. | Fix the package code or manifest; do not patch generic app/gateway/session/kernel code. |
| Template factory confusion | `CapsuleTemplate` or `TemplatePackage` declares an executable runtime factory. | Remove the runtime factory from the template package or split a real provider package out separately. |
| Narrow-waist import | Runtime packages import a concrete provider or provider-owned type. | Move the import into the provider package or registry bootstrap boundary. |

## 7. Guarded Operations As UX Constraints

The authoring UX should show guarded operations in context, not as the journey structure.

Allowed inside this flow:

- emit and validate package source manifests, schemas, tests, skills/docs, and optional WPM bundle source;
- run local validation, redaction checks, contract tests, and fake-host dependency tests;
- generate a readiness report for the next flow.

Not allowed inside this flow:

- write selected app deployment config, capsule template defaults, or install/update overlays for a running deployment;
- write WPM receipt evidence for a host;
- mutate daemon config, live ProviderRegistry/internal factory-runner state, runtime catalogs, routes, grants,
  sessions, or provider state;
- register executable provider code after daemon boot;
- make generic app, gateway, session, identity, worker, route, completion, or kernel packages import provider-specific
  implementation types.

When the author tries a guarded operation, the UX should explain the next correct flow: operator install/update for
deployment/WPM/daemon changes, or runtime consumption for catalog/template/session proposal work.

## 8. Success State And Handoff

The provider-authoring flow is successful when `inspect` can produce a reviewer/operator handoff packet. This success
state is **ready to stage**, not `available`: availability is still derived later from ProviderRegistry boot,
deployment/template selection, WPM receipt evidence, and current probes.

- package id, version, kind, and family;
- files produced by scaffold and changed by the author;
- manifest/schema/probe/skills/docs summary;
- dependency requirements and optional WPM bundle refs;
- test report and redaction report;
- whether the package is a runtime `ProviderPackage`, catalog `TemplatePackage`, or both;
- operator install/update instructions limited to the next flow: add to a trusted registry/bootstrap source, select
  through app deployment config or capsule templates, run WPM for host dependencies, boot/doctor the daemon, and
  verify availability.

The handoff packet should make incompleteness obvious. A reviewer should not need to read provider code to discover
that a skill, probe, schema, dependency requirement, redaction check, or contract test is missing.

## 9. Non-Goals

- No marketplace, public plugin ABI, or version solver.
- No dynamic hot-loading.
- No deployment/template selection application, WPM receipt writing, daemon restart, or runtime session proposal.
- No visual style decisions; this story specifies workflow behavior and diagnostics for a developer UX.

## Related

`provider-graph-defaults-and-extension-plan.md` defines the three separate UX flows and provider graph direction.
`provider-author-workflow.md` defines the package boundary rules. `provider-install-update-ux.md` defines the next
operator flow. `../02-provider-and-extension-model.md` defines the uniform provider contract and install-time/runtime
split.
