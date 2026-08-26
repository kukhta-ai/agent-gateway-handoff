---
id: GLA-101
title: Enforce Provider Host boundaries with contract tests
status: Done
assignee: []
created_date: '2026-06-14 13:25'
updated_date: '2026-06-14 17:27'
labels:
  - architecture
  - provider-host
  - testing
  - boundary
  - quality-gate
dependencies:
  - GLA-096
  - GLA-097
  - GLA-098
  - GLA-099
  - GLA-100
references:
  - docs/architecture/test-strategy.md
  - docs/task-writing-conventions.md
  - biome.json
  - packages/app/src/index.ts
documentation:
  - docs/architecture/provider-host-extension-architecture.md
priority: high
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after provider families migrate behind Provider Host, the architecture needs executable guardrails. Otherwise new providers can reintroduce concrete imports, provider-specific type leaks, duplicated manifest tables, or false-positive tests that prove only the reference providers still work.

Context: this task is the cross-family hardening pass. It should not over-engineer a marketplace or public ABI. Its purpose is to make the internal provider-host architecture observable in CI and easy for future provider authors to follow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Import-boundary checks fail when app, gateway, session, identity, route, completion, worker core, or kernel packages import individual provider adapter packages or provider-owned implementation types outside the approved provider-set boundary and tests.
- [x] #2 Each migrated provider family has a fake-provider contract test proving registration, catalog/schema/skill visibility, probe-derived availability, config validation, and runtime selection without narrow-waist package edits.
- [x] #3 Provider package contract tests verify that manifest identity, family, config schema, dependency requirements, probes, skills/docs, factory registration, and compatibility declarations describe one coherent provider.
- [x] #4 Tests cover negative outcomes for duplicate provider ids, unknown selected providers, invalid config, missing dependency bindings, failed probes, unavailable template parts, and secret-bearing diagnostics.
- [x] #5 Developer docs describe the provider-author workflow: where provider code lives, what manifest/docs/skills/probes/tests it must ship, what WPM owns, and which core/app files must not be edited for a new provider.
- [x] #6 The project quality gate includes the provider-host boundary checks, and the existing reference-slice E2E tests still pass through the provider-host path.
<!-- AC:END -->













## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-101 evidence: bmad-create-story, bmad-dev-story, and bmad-qa-generate-e2e-tests were loaded by the persistent worker; sprint-status/story artifacts are absent in this repo, so the documented Backlog.md/docs fallback was used. Independent architect lane APPROVE; reviewer lane APPROVE using story-automator-review checklist against Backlog.md contract; TEA initially raised a CommonJS require false-negative, scanner was patched and TEA re-review PASS. Full pnpm gate passed after the fix: typecheck, biome ci ., browser E2E preflight required, 66 Vitest files, 775 passed / 15 skipped. Added Provider Host boundary scanner, CJS/ESM/subpath negative selftests, cross-family fake provider contract tests, provider package coherence tests, app dependency boundary assertions, and provider-author docs.
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
