---
id: GLA-102
title: Define the package-local test layout and gate contract
status: Done
assignee: []
created_date: '2026-06-14 13:34'
updated_date: '2026-06-14 17:42'
labels:
  - test-architecture
  - quality-gate
  - source-layout
  - typescript
  - vitest
dependencies: []
references:
  - vitest.config.ts
  - tsconfig.json
  - package.json
  - docs/architecture/provider-host-extension-architecture.md
documentation:
  - docs/architecture/test-strategy.md
priority: high
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: tests currently live beside runtime code under src, which keeps typechecking simple but makes runtime source directories noisy and blurs the provider-package contract. The project needs a documented and executable layout where src is runtime code, package-owned tests live beside the package but outside src, and cross-cutting scenario/boundary tests have a clear home.

Context: the target layout should preserve the modular-monolith and provider-package vision: each package/provider owns its unit and contract tests, packages/app owns composition-root integration and E2E tests, and top-level tests remain reserved for cross-package boundary or scenario harnesses. The change must not make test files fall out of typechecking.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A documented test layout distinguishes runtime source, package-local unit tests, package-local contract tests, app integration/E2E tests, package fixtures, and top-level cross-cutting scenario or boundary tests.
- [x] #2 The quality gate typechecks tests that live outside src with the same strictness as current src-co-located tests.
- [x] #3 Vitest discovers the documented test locations without requiring test files to live under src.
- [x] #4 Production package builds and emitted dist artifacts exclude tests and fixtures while preserving test typechecking in the gate.
- [x] #5 The documented convention explains how provider packages ship contract tests with provider code without placing runtime tests in src.
- [x] #6 The migration path preserves current test behavior and does not weaken browser-E2E preflight or existing boundary checks.
<!-- AC:END -->













## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GLA-102 evidence: persistent worker loaded bmad-create-story, bmad-dev-story, and bmad-qa-generate-e2e-tests; sprint-status/story artifact is absent, so the documented Backlog.md/docs fallback was used. Architect lane APPROVE, reviewer lane APPROVE using story-automator-review checklist against Backlog.md contract, and TEA PASS. Implemented source/test layout contract in docs/architecture/test-strategy.md and CONTRIBUTING.md; added tsconfig.tests.json strict no-emit test typecheck; production typecheck now cleans dist, builds runtime src, typechecks tests, and runs dist-layout guard; Vitest includes top-level tests; browser E2E preflight accepts current and documented migrated paths; added outside-src smoke tests for package unit, provider contract, app E2E, and top-level boundary locations. Full pnpm gate passed after review/doc fix: typecheck clean/build/test-typecheck/dist-layout, biome ci ., required browser preflight, 70 Vitest files, 779 passed / 15 skipped.
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
