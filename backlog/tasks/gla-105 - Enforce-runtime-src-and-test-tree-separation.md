---
id: GLA-105
title: Enforce runtime src and test tree separation
status: To Do
assignee: []
created_date: '2026-06-14 13:35'
labels:
  - test-architecture
  - source-layout
  - boundary
  - quality-gate
  - lint
dependencies:
  - GLA-103
  - GLA-104
references:
  - vitest.config.ts
  - tsconfig.json
  - biome.json
  - package.json
  - tools/boundary-check/src/boundary.test.ts
documentation:
  - docs/architecture/test-strategy.md
priority: high
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: moving tests out of src is only durable if the quality gate rejects regressions. Otherwise new unit, contract, or E2E tests will gradually drift back into runtime source directories because that was the historical pattern.

Context: enforcement should be lightweight and aligned with the project style: checks in the same gate developers already run, not a heavy new framework. The rule is not that all tests live top-level; the rule is that runtime src contains runtime code, while package-local and app-local tests live in their documented test trees.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The quality gate fails when new test files are placed under runtime src directories except for explicitly documented temporary exceptions.
- [ ] #2 The repository has a machine-checkable allowlist or convention for package-local test directories, app E2E directories, fixtures, and top-level cross-cutting test harnesses.
- [ ] #3 Production build configuration, package exports, and emitted artifacts exclude test directories, fixtures, and test-only helpers.
- [ ] #4 Test-only imports are constrained so production runtime code cannot import package-local tests, fixtures, or fake providers.
- [ ] #5 The source/test separation check is documented with the quality gate and produces actionable diagnostics naming the misplaced file and expected location.
- [ ] #6 Existing provider-host boundary and browser-E2E checks continue to run under the same gate after source/test separation enforcement is enabled.
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
