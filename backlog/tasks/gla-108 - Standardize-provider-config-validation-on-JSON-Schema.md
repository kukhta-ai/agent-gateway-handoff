---
id: GLA-108
title: Standardize provider config validation on JSON Schema
status: Done
assignee: []
created_date: '2026-06-15 11:46'
updated_date: '2026-06-15 12:40'
labels:
  - tech-debt
  - architecture
  - provider-graph
dependencies:
  - GLA-107
references:
  - docs/architecture/provider-graph-defaults-and-extension-plan.md
  - packages/kernel/src/config-schema.ts
  - packages/catalog/src/provider-authoring.ts
  - packages/catalog/src/index.ts
priority: high
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from the architecture/library review: provider config validation is still a custom schema dialect and now has authoring/runtime consistency risk around config_schema versus factory_config_schema. The selected direction is to keep GLA's validateConfig boundary stable while moving the underlying validation contract to a conservative JSON Schema profile, with Ajv as the preferred engine and TypeBox only as an optional authoring helper.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Provider, template-package, profile, and runtime config inputs are validated through one documented schema contract that callers can inspect as data.
- [x] #2 Invalid config reports all discoverable field-level defects in GLA's existing stable diagnostic shape, including path, code, and human-readable message.
- [x] #3 Unknown fields, missing required fields, type mismatches, enum/range/pattern violations, nested object defects, and list-item defects are rejected consistently anywhere provider config is accepted.
- [x] #4 Authoring validation and provider-graph/runtime validation choose the same schema for runtime config versus factory construction config, so the same input cannot pass one surface and fail another for schema-selection reasons.
- [x] #5 Validation has no mutation side effects: defaults, coercion, unknown-field removal, and redaction metadata remain explicit GLA behavior rather than implicit validator behavior.
- [x] #6 Untrusted or oversized provider-authored schemas fail closed with typed diagnostics rather than causing unbounded validation work or uncaught validator errors.
<!-- AC:END -->













## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-108 implementation: ran bmad-create-story/dev-story/qa-generate-e2e-tests workflow instructions; repo has no sprint-status/story artifact, so Backlog.md/docs fallback was used and recorded per AGENTS Rule 3. Reviewer Planck performed story-automator-review-style read-only review; blockers were fixed; final re-review reported no blocking findings. Verification: pnpm gate passed with required browser E2E.
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
