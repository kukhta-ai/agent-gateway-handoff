---
id: GLA-108
title: Adopt Ajv-backed JSON Schema provider config validation
status: Done
assignee: []
created_date: '2026-06-15 11:46'
updated_date: '2026-06-15 13:59'
labels:
  - tech-debt
  - architecture
  - provider-graph
  - ajv
dependencies:
  - GLA-107
references:
  - docs/architecture/provider-graph-defaults-and-extension-plan.md
  - packages/kernel/src/config-schema.ts
  - packages/catalog/src/provider-authoring.ts
  - packages/catalog/src/index.ts
  - 'https://ajv.js.org/'
modified_files:
  - packages/kernel/src/config-schema.ts
  - packages/catalog/src/provider-authoring.ts
  - packages/catalog/src/index.ts
priority: high
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from the architecture/library review: provider config validation must move from the project-maintained schema validator to full Ajv-backed JSON Schema validation. The stable GLA validation boundary and diagnostic contract remain, but Ajv becomes the validation engine for provider config schemas across authoring, catalog graph projection, runtime config, and factory construction config. TypeBox may be used only as an optional authoring helper; the externally visible contract is JSON Schema data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Provider config schemas are represented and exposed as a documented JSON Schema profile that provider authors and CLI/catalog callers can inspect as data.
- [x] #2 Provider, template-package, profile, runtime, and factory construction config validation all run through one Ajv-backed validation boundary rather than a parallel project-maintained schema validator.
- [x] #3 Authoring validation and provider-graph/runtime validation choose the same schema for runtime config versus factory construction config, so the same input cannot pass one surface and fail another for schema-selection reasons.
- [x] #4 Invalid config reports all discoverable field-level defects in GLA's existing stable diagnostic shape, including path, code, and human-readable message, without leaking sensitive values.
- [x] #5 Ajv validation is configured fail-closed for this product boundary: unknown fields reject, schema validation is strict, defaults/coercion/field removal do not mutate inputs, and unsafe or oversized provider-authored schemas produce typed diagnostics.
- [x] #6 Existing config-schema behavior that remains part of the public GLA contract has parity coverage after the Ajv migration, including nested objects, lists, enums, ranges, patterns, cross-field constraints, and sensitive metadata.
<!-- AC:END -->













## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Corrected GLA-108 implemented on feature/provider-graph-task-108-corrected. Existing JSON Schema migration was strengthened to satisfy corrected Ajv-backed contract: Ajv now runs with strict schema/type/required/tuple checks, branch keywords are part of the documented profile, strict-valid cross-field branches are covered, sensitive schema literals and input values are not emitted in field defects, and ignored keyword/type mistakes fail closed with typed diagnostics. Existing authoring/profile/graph/runtime/factory paths continue to use the kernel validateConfig/validateSchemaShape boundary. Independent reviewer Planck re-reviewed after strict-mode fix; final result: no blocking findings. Verification: pnpm run gate passed with required browser E2E (863 passed / 15 skipped).
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Typecheck passes with no errors.
- [x] #2 Linter passes clean.
- [x] #3 Tests are added for the change and the full suite is green.
- [x] #4 Public functions and exported types are documented.
- [x] #5 No dead code or unused exports are introduced.
- [x] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
