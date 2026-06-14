---
id: GLA-101
title: Enforce Provider Host boundaries with contract tests
status: To Do
assignee: []
created_date: '2026-06-14 13:25'
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
- [ ] #1 Import-boundary checks fail when app, gateway, session, identity, route, completion, worker core, or kernel packages import individual provider adapter packages or provider-owned implementation types outside the approved provider-set boundary and tests.
- [ ] #2 Each migrated provider family has a fake-provider contract test proving registration, catalog/schema/skill visibility, probe-derived availability, config validation, and runtime selection without narrow-waist package edits.
- [ ] #3 Provider package contract tests verify that manifest identity, family, config schema, dependency requirements, probes, skills/docs, factory registration, and compatibility declarations describe one coherent provider.
- [ ] #4 Tests cover negative outcomes for duplicate provider ids, unknown selected providers, invalid config, missing dependency bindings, failed probes, unavailable template parts, and secret-bearing diagnostics.
- [ ] #5 Developer docs describe the provider-author workflow: where provider code lives, what manifest/docs/skills/probes/tests it must ship, what WPM owns, and which core/app files must not be edited for a new provider.
- [ ] #6 The project quality gate includes the provider-host boundary checks, and the existing reference-slice E2E tests still pass through the provider-host path.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Typecheck passes with no errors.
- [ ] #2 Linter passes clean.
- [ ] #3 Tests are added for the change and the full suite is green.
- [ ] #4 Public functions and exported types are documented.
- [ ] #5 No dead code or unused exports are introduced.
- [ ] #6 The core import-boundary holds: core depends only on ports, never on concrete adapters.
<!-- DOD:END -->
